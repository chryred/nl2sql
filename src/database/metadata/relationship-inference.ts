/**
 * 네이밍 패턴 기반 FK 관계 자동 추론 엔진
 *
 * @description
 * naming_conventions 테이블의 패턴과 동일 컬럼명 매칭을 활용하여
 * FK 제약조건 없이도 테이블 간 관계를 자동으로 추론합니다.
 *
 * @module database/metadata/relationship-inference
 */

import type { Knex } from 'knex';
import type { DatabaseType } from '../types.js';
import type {
  NamingConvention,
  TableRelationship,
  ConfidenceLevel,
  RelationshipType,
  JoinHint,
} from './types.js';
import { loadMetadataQueries } from './query-loader.js';
import { encodeForOracle } from '../charset-converter.js';
import { logger } from '../../logger/index.js';
import type { AIProvider } from '../../ai/providers/openai.js';
import { formatSchemaForPrompt } from '../schema-extractor.js';
import type { ExtendedTableInfo } from '../types.js';
import type { MetadataCache } from './types.js';

// =============================================================================
// 타입 정의
// =============================================================================

/**
 * 추론된 관계 후보
 */
export interface InferredRelationship {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  confidenceLevel: ConfidenceLevel;
  inferenceType: 'naming_convention' | 'column_match';
  matchedPattern?: string;
  description: string;
  // LLM 추론 시 추가 정보
  relationshipType?: RelationshipType;   // 없으면 upsert에서 'MANY_TO_ONE' 기본값
  joinHint?: JoinHint;                   // 없으면 upsert에서 'LEFT' 기본값
}

/**
 * 추론 옵션
 */
export interface InferenceOptions {
  schema?: string;
  types?: ('naming_convention' | 'column_match')[];
  schemaTables: ExtendedTableInfo[];
  // LLM 기반 추론에 필요한 선택적 파라미터
  aiProvider?: AIProvider;
  metadata?: MetadataCache;
}

/**
 * 추론 결과
 */
export interface InferenceResult {
  candidates: InferredRelationship[];
  applied?: number;
  skipped?: number;
}

// =============================================================================
// 복수형 변환 유틸리티
// =============================================================================

/**
 * 영어 단수형을 복수형으로 변환합니다.
 *
 * @param word - 단수형 단어
 * @returns 복수형 변환 후보 배열
 */
export function pluralize(word: string): string[] {
  const candidates: string[] = [];

  // +s
  candidates.push(word + 's');

  // +es (sh, ch, s, x, z로 끝나는 경우)
  if (/(?:sh|ch|s|x|z)$/i.test(word)) {
    candidates.push(word + 'es');
  }

  // y → ies (자음 + y)
  if (/[^aeiou]y$/i.test(word)) {
    candidates.push(word.replace(/y$/i, 'ies'));
  }

  return candidates;
}

/**
 * 영어 복수형을 단수형으로 변환합니다.
 *
 * @param word - 복수형 단어
 * @returns 단수형 변환 후보 배열
 */
export function singularize(word: string): string[] {
  const candidates: string[] = [];

  // ies → y
  if (/ies$/i.test(word)) {
    candidates.push(word.replace(/ies$/i, 'y'));
  }

  // es → 제거 (sh, ch, s, x, z + es)
  if (/(?:sh|ch|ss|x|z)es$/i.test(word)) {
    candidates.push(word.replace(/es$/i, ''));
  }

  // s → 제거
  if (/s$/i.test(word) && !/ss$/i.test(word)) {
    candidates.push(word.replace(/s$/i, ''));
  }

  return candidates;
}

/**
 * Oracle upsert에서 {{DESCRIPTION_BIND}} 플레이스홀더를 처리합니다.
 */
function buildDescriptionBind(
  sql: string,
  oracleDataCharset?: string
): string {
  if (oracleDataCharset) {
    return sql.replace(
      '{{DESCRIPTION_BIND}}',
      'UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(?))'
    );
  }
  return sql.replace('{{DESCRIPTION_BIND}}', '?');
}


// =============================================================================
// 추론 핵심 로직
// =============================================================================

/**
 * 테이블 존재 여부를 빠르게 확인하기 위한 Set을 구축합니다.
 */
function buildTableSetFromSchema(
  tables: ExtendedTableInfo[]
): Map<string, Set<string>> {
  const schemaMap = new Map<string, Set<string>>();
  for (const t of tables) {
    const key = (t.schemaName ?? '').toLowerCase();
    if (!schemaMap.has(key)) {
      schemaMap.set(key, new Set());
    }
    schemaMap.get(key)!.add(t.name.toLowerCase());
  }
  return schemaMap;
}

/**
 * 컬럼 존재 여부를 빠르게 확인하기 위한 Set을 구축합니다.
 */
function buildColumnSetFromSchema(
  tables: ExtendedTableInfo[]
): Set<string> {
  const set = new Set<string>();
  for (const t of tables) {
    for (const col of t.columns) {
      set.add(
        `${(t.schemaName ?? '').toLowerCase()}.${t.name.toLowerCase()}.${col.name.toLowerCase()}`
      );
    }
  }
  return set;
}

/**
 * FK 추론용 슬림 스키마를 생성합니다.
 *
 * @description
 * 500개 이상의 테이블 환경에서 LLM 입력 크기를 줄이기 위해
 * PK, 인덱스 컬럼, FK 패턴(_id/_code/_cd/_no/_key/_seq/_type/_flag/_yn) 컬럼만 유지합니다.
 */
function buildFKSlimTables(tables: ExtendedTableInfo[]): ExtendedTableInfo[] {
  const FK_SUFFIX = /(_id|_code|_cd|_no|_key|_seq|_type|_flag|_yn)$/i;

  return tables.map((table) => {
    const indexedColNames = new Set<string>();
    for (const idx of table.indexes ?? []) {
      for (const col of idx.columns) {
        indexedColNames.add(col.toLowerCase());
      }
    }

    const slimColumns = table.columns.filter(
      (col) =>
        col.isPrimaryKey ||
        indexedColNames.has(col.name.toLowerCase()) ||
        FK_SUFFIX.test(col.name)
    );

    return {
      ...table,
      // 필터 결과가 없으면 첫 3개 보장 (완전히 빈 테이블 방지)
      columns: slimColumns.length > 0 ? slimColumns : table.columns.slice(0, 3),
      // 인덱스는 PK/unique만 유지
      indexes: (table.indexes ?? []).filter((idx) => idx.unique),
    };
  });
}


/**
 * 기존 관계 중복 확인을 위한 Set을 구축합니다.
 */
function buildExistingRelationshipSet(
  relationships: TableRelationship[]
): Set<string> {
  const set = new Set<string>();
  for (const r of relationships) {
    set.add(
      `${r.sourceSchema.toLowerCase()}.${r.sourceTable.toLowerCase()}.${r.sourceColumn.toLowerCase()}` +
        `→${r.targetSchema.toLowerCase()}.${r.targetTable.toLowerCase()}.${r.targetColumn.toLowerCase()}`
    );
  }
  return set;
}

/**
 * 테이블명을 찾습니다 (정확한 이름 또는 복수형/단수형 변환).
 */
function findTable(
  candidateTable: string,
  schema: string,
  tableSet: Map<string, Set<string>>,
  applyPluralization: boolean
): string | null {
  const schemaLower = schema.toLowerCase();
  const tables = tableSet.get(schemaLower);
  if (!tables) return null;

  const candidateLower = candidateTable.toLowerCase();

  // 원래 형태
  if (tables.has(candidateLower)) return candidateTable;

  if (applyPluralization) {
    // 복수형 변환 시도
    for (const plural of pluralize(candidateTable)) {
      if (tables.has(plural.toLowerCase())) return plural;
    }

    // 단수형 변환 시도 (candidate가 이미 복수형일 수 있음)
    for (const singular of singularize(candidateTable)) {
      if (tables.has(singular.toLowerCase())) return singular;
    }
  }

  return null;
}

/**
 * 네이밍 컨벤션 기반으로 관계를 추론합니다.
 *
 * @param columns - DB 컬럼 목록
 * @param namingConventions - 네이밍 컨벤션 규칙
 * @param existingSet - 기존 관계 Set
 * @param tableSet - 테이블 존재 확인용 Map
 * @param columnSet - 컬럼 존재 확인용 Set
 * @returns 추론된 관계 후보
 */
function inferByNamingConvention(
  schemaTables: ExtendedTableInfo[],
  namingConventions: NamingConvention[],
  existingSet: Set<string>,
  tableSet: Map<string, Set<string>>,
  columnSet: Set<string>
): InferredRelationship[] {
  const candidates: InferredRelationship[] = [];
  const seen = new Set<string>();

  // 우선순위 순으로 정렬
  const sortedConventions = [...namingConventions].sort(
    (a, b) => a.priority - b.priority
  );

  for (const conv of sortedConventions) {
    let regex: RegExp;
    try {
      regex = new RegExp(conv.columnPattern, 'i');
    } catch {
      logger.warn(
        `Invalid regex in naming convention '${conv.name}': ${conv.columnPattern}`
      );
      continue;
    }

    for (const table of schemaTables) {
      const tableSchema = table.schemaName ?? '';
      const tableName = table.name;

      // 스키마 필터
      if (
        conv.applyToSchemas &&
        conv.applyToSchemas.length > 0 &&
        !conv.applyToSchemas.some(
          (s) => s.toLowerCase() === tableSchema.toLowerCase()
        )
      ) {
        continue;
      }

      // 테이블 제외 필터
      if (
        conv.excludeTables &&
        conv.excludeTables.some(
          (t) => t.toLowerCase() === tableName.toLowerCase()
        )
      ) {
        continue;
      }

      for (const col of table.columns) {
        const columnName = col.name;
        const match = columnName.match(regex);
        if (!match) continue;

        // 타겟 테이블명 추론
        let candidateTable = conv.targetTablePattern;
        let candidateColumn = conv.targetColumnPattern;

        // 캡처 그룹 치환 ($1, $2, ...)
        for (let i = 1; i < match.length; i++) {
          const groupVal = match[i] || '';
          candidateTable = candidateTable.replace(`$${i}`, groupVal);
          candidateColumn = candidateColumn.replace(`$${i}`, groupVal);
        }

        // 접두사/접미사 제거
        if (conv.tablePrefixStrip) {
          const prefixRegex = new RegExp(
            `^${escapeRegex(conv.tablePrefixStrip)}`,
            'i'
          );
          candidateTable = candidateTable.replace(prefixRegex, '');
        }
        if (conv.tableSuffixStrip) {
          const suffixRegex = new RegExp(
            `${escapeRegex(conv.tableSuffixStrip)}$`,
            'i'
          );
          candidateTable = candidateTable.replace(suffixRegex, '');
        }

        // 같은 스키마에서 테이블 찾기
        const actualTable = findTable(
          candidateTable,
          tableSchema,
          tableSet,
          conv.applyPluralization
        );
        if (!actualTable) continue;

        // 타겟 컬럼 존재 확인
        const targetColKey = `${tableSchema.toLowerCase()}.${actualTable.toLowerCase()}.${candidateColumn.toLowerCase()}`;
        if (!columnSet.has(targetColKey)) continue;

        // 자기 참조 제외 (같은 테이블, 같은 컬럼)
        if (
          tableName.toLowerCase() === actualTable.toLowerCase() &&
          columnName.toLowerCase() === candidateColumn.toLowerCase()
        ) {
          continue;
        }

        // 중복 확인
        const relKey =
          `${tableSchema.toLowerCase()}.${tableName.toLowerCase()}.${columnName.toLowerCase()}` +
          `→${tableSchema.toLowerCase()}.${actualTable.toLowerCase()}.${candidateColumn.toLowerCase()}`;

        if (existingSet.has(relKey) || seen.has(relKey)) continue;
        seen.add(relKey);

        candidates.push({
          sourceSchema: tableSchema,
          sourceTable: tableName,
          sourceColumn: columnName,
          targetSchema: tableSchema,
          targetTable: actualTable,
          targetColumn: candidateColumn,
          confidenceLevel: 'MEDIUM',
          inferenceType: 'naming_convention',
          matchedPattern: conv.name,
          description: `네이밍 컨벤션 '${conv.name}' 기반 추론: ${columnName} → ${actualTable}.${candidateColumn}`,
        });
      }
    }
  }

  return candidates;
}

/**
 * LLM FK 추론용 프롬프트를 생성합니다.
 */
function buildFKInferencePrompt(
  schemaTables: ExtendedTableInfo[],
  existingSet: Set<string>,
  namingConventions: NamingConvention[],
  metadata?: MetadataCache
): string {
  const sections: string[] = [];

  // 1. 슬림 스키마 정보 (PK/인덱스/FK패턴 컬럼만 포함)
  const slimTables = buildFKSlimTables(schemaTables);
  sections.push(`=== Database Schema (FK inference — PK/Index/FK-pattern columns only) ===\n${formatSchemaForPrompt(slimTables)}`);

  // 2. 기존 관계 (중복 방지)
  if (existingSet.size > 0) {
    const relLines = [...existingSet].map((r) => `  - ${r.replace('→', ' → ')}`);
    sections.push(`=== Existing Relationships (이미 등록됨, 중복 금지) ===\n${relLines.join('\n')}`);
  }

  // 3. 비즈니스 용어집
  if (metadata?.glossaryTerms && metadata.glossaryTerms.length > 0) {
    const glossLines = metadata.glossaryTerms.slice(0, 20).map((t) => {
      const def = t.definition ? ` - ${t.definition}` : '';
      return `  - "${t.term}" → ${t.sqlCondition}${def}`;
    });
    sections.push(`=== Business Glossary ===\n${glossLines.join('\n')}`);
  }

  // 4. 네이밍 컨벤션 (참고용)
  if (namingConventions.length > 0) {
    const ncLines = namingConventions.slice(0, 10).map(
      (nc) => `  - 컬럼 패턴 ${nc.columnPattern} → ${nc.targetTablePattern}.${nc.targetColumnPattern}`
    );
    sections.push(`=== Naming Conventions (참고용) ===\n${ncLines.join('\n')}`);
  }

  return sections.join('\n\n');
}


/**
 * LLM 기반으로 FK 관계를 추론합니다.
 */
export async function inferByLLM(
  aiProvider: AIProvider | undefined,
  schemaTables: ExtendedTableInfo[],
  metadata: MetadataCache | undefined,
  existingSet: Set<string>,
  namingConventions: NamingConvention[] = []
): Promise<InferredRelationship[]> {
  if (!aiProvider) {
    logger.warn('inferByLLM: aiProvider not provided, skipping LLM inference');
    return [];
  }
  const prompt = buildFKInferencePrompt(schemaTables, existingSet, namingConventions, metadata);

  let rawResponse: string;
  try {
    rawResponse = await aiProvider.generateInferFK(prompt);
  } catch (err) {
    logger.warn(`inferByLLM: AI call failed — ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  // JSON 파싱
  let parsed: unknown[];
  try {
    // 마크다운 코드블록 제거 (```json ... ```)
    const cleaned = rawResponse.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned) as unknown[];
    if (!Array.isArray(parsed)) {
      logger.warn('inferByLLM: LLM response is not a JSON array');
      return [];
    }
  } catch {
    logger.warn(`inferByLLM: Failed to parse LLM response as JSON: ${rawResponse.slice(0, 200)}`);
    return [];
  }

  // 스키마 내 테이블/컬럼 존재 확인용 Set 구축
  const tableColSet = new Set<string>();
  for (const t of schemaTables) {
    for (const c of t.columns) {
      tableColSet.add(
        `${(t.schemaName ?? '').toLowerCase()}.${t.name.toLowerCase()}.${c.name.toLowerCase()}`
      );
    }
  }

  const candidates: InferredRelationship[] = [];
  const seen = new Set<string>();

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;

    const sourceSchema = String(r['source_schema'] ?? '');
    const sourceTable  = String(r['source_table']  ?? '');
    const sourceColumn = String(r['source_column'] ?? '');
    const targetSchema = String(r['target_schema'] ?? '');
    const targetTable  = String(r['target_table']  ?? '');
    const targetColumn = String(r['target_column'] ?? '');

    if (!sourceTable || !sourceColumn || !targetTable || !targetColumn) {
      logger.warn(`inferByLLM: skipping incomplete item: ${JSON.stringify(r)}`);
      continue;
    }

    // 존재하지 않는 컬럼이면 skip
    const srcKey = `${sourceSchema.toLowerCase()}.${sourceTable.toLowerCase()}.${sourceColumn.toLowerCase()}`;
    const tgtKey = `${targetSchema.toLowerCase()}.${targetTable.toLowerCase()}.${targetColumn.toLowerCase()}`;
    if (!tableColSet.has(srcKey)) {
      logger.warn(`inferByLLM: source column not found: ${srcKey}`);
      continue;
    }
    if (!tableColSet.has(tgtKey)) {
      logger.warn(`inferByLLM: target column not found: ${tgtKey}`);
      continue;
    }

    // 중복 확인
    const relKey = `${srcKey}→${tgtKey}`;
    if (existingSet.has(relKey) || seen.has(relKey)) continue;
    seen.add(relKey);

    const confidenceRaw = String(r['confidence'] ?? 'LOW').toUpperCase();
    const confidenceLevel: ConfidenceLevel =
      confidenceRaw === 'HIGH' ? 'HIGH' :
      confidenceRaw === 'MEDIUM' ? 'MEDIUM' : 'LOW';

    const relType = String(r['relationship_type'] ?? 'MANY_TO_ONE') as RelationshipType;
    const validJoinHints = ['INNER', 'LEFT', 'RIGHT'] as const;
    const rawJoinHint = String(r['join_hint'] ?? 'LEFT').toUpperCase();
    const joinH: JoinHint = (validJoinHints as readonly string[]).includes(rawJoinHint)
      ? (rawJoinHint as JoinHint)
      : 'LEFT';

    candidates.push({
      sourceSchema,
      sourceTable,
      sourceColumn,
      targetSchema,
      targetTable,
      targetColumn,
      confidenceLevel,
      inferenceType: 'column_match',
      description: String(r['description'] ?? `LLM 추론: ${sourceTable}.${sourceColumn} → ${targetTable}.${targetColumn}`),
      relationshipType: relType,
      joinHint: joinH,
    });
  }

  logger.info(`inferByLLM: ${candidates.length} candidates inferred`);
  return candidates;
}

// =============================================================================
// 공개 API
// =============================================================================

/**
 * FK 제약조건 없는 테이블 간 관계를 추론합니다.
 *
 * @param knex - Knex 데이터베이스 연결
 * @param dbType - 데이터베이스 타입
 * @param namingConventions - 캐시된 네이밍 컨벤션 규칙
 * @param existingRelationships - 기존 관계 목록
 * @param options - 추론 옵션
 * @returns 추론된 관계 후보 목록
 */
export async function inferRelationships(
  namingConventions: NamingConvention[],
  existingRelationships: TableRelationship[],
  options: InferenceOptions
): Promise<InferredRelationship[]> {
  const { schemaTables, schema, types: optTypes, aiProvider, metadata } = options;
  const types = optTypes ?? ['naming_convention', 'column_match'];

  // 스키마 필터 적용
  const filteredTables = schema
    ? schemaTables.filter(
        (t) => t.schemaName?.toLowerCase() === schema.toLowerCase()
      )
    : schemaTables;

  logger.info(
    `Starting relationship inference (types: ${types.join(', ')}, schema: ${schema ?? 'all'}, tables: ${filteredTables.length})`
  );

  if (filteredTables.length === 0) {
    logger.warn('inferRelationships: no tables available after schema filter');
    return [];
  }

  // 인덱스 구조 구축
  const tableSet = buildTableSetFromSchema(filteredTables);
  const columnSet = buildColumnSetFromSchema(filteredTables);
  const existingSet = buildExistingRelationshipSet(existingRelationships);

  const allCandidates: InferredRelationship[] = [];

  // 1) 네이밍 컨벤션 기반 추론
  if (types.includes('naming_convention') && namingConventions.length > 0) {
    const ncCandidates = inferByNamingConvention(
      filteredTables,
      namingConventions,
      existingSet,
      tableSet,
      columnSet
    );
    logger.info(
      `Naming convention inference: ${ncCandidates.length} candidates`
    );
    allCandidates.push(...ncCandidates);

    // 네이밍 컨벤션 결과도 existing에 추가 (LLM 추론 시 중복 방지)
    for (const c of ncCandidates) {
      existingSet.add(
        `${c.sourceSchema.toLowerCase()}.${c.sourceTable.toLowerCase()}.${c.sourceColumn.toLowerCase()}` +
          `→${c.targetSchema.toLowerCase()}.${c.targetTable.toLowerCase()}.${c.targetColumn.toLowerCase()}`
      );
    }
  }

  // 2) LLM 기반 추론 (column_match 타입)
  if (types.includes('column_match')) {
    const cmCandidates = await inferByLLM(
      aiProvider,
      filteredTables,
      metadata,
      existingSet,
      namingConventions
    );
    logger.info(`LLM inference: ${cmCandidates.length} candidates`);
    allCandidates.push(...cmCandidates);
  }

  logger.info(`Total inferred candidates: ${allCandidates.length}`);
  return allCandidates;
}

/**
 * 추론된 관계를 DB에 적용합니다.
 *
 * @param knex - Knex 데이터베이스 연결
 * @param dbType - 데이터베이스 타입
 * @param candidates - 적용할 관계 후보
 * @param oracleDataCharset - Oracle 한글 인코딩용 캐릭터셋
 * @returns 적용 결과 (applied, skipped 건수)
 */
export async function applyInferredRelationships(
  knex: Knex,
  dbType: DatabaseType,
  candidates: InferredRelationship[],
  oracleDataCharset?: string
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;

  for (const c of candidates) {
    try {
      let isActive: boolean;
      let createdBy: string;
      if (c.inferenceType === 'naming_convention') {
        isActive = c.confidenceLevel === 'MEDIUM';
        createdBy = 'naming_convention';
      } else {
        // LLM 기반 추론 (column_match 타입)
        isActive = true;
        createdBy = 'llm_inference';
      }

      const inserted = await upsertRelationship(
        knex,
        dbType,
        c,
        isActive,
        createdBy,
        oracleDataCharset
      );

      if (inserted) {
        applied++;
      } else {
        skipped++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Failed to apply relationship ${c.sourceTable}.${c.sourceColumn} → ${c.targetTable}.${c.targetColumn}: ${msg}`
      );
      skipped++;
    }
  }

  return { applied, skipped };
}

/**
 * 관계를 UPSERT합니다.
 */
async function upsertRelationship(
  knex: Knex,
  dbType: DatabaseType,
  candidate: InferredRelationship,
  isActive: boolean,
  createdBy: string,
  oracleDataCharset?: string
): Promise<boolean> {
  const config = loadMetadataQueries(dbType);
  const queryDef = config.queries.inferenceUpsert;
  if (!queryDef) {
    throw new Error(`inferenceUpsert query not defined for ${dbType}`);
  }

  let sql = queryDef.sql;
  const isActiveVal = dbType === 'oracle' || dbType === 'mysql'
    ? (isActive ? 1 : 0)
    : isActive;

  const relationshipTypeVal = candidate.relationshipType ?? 'MANY_TO_ONE';
  const joinHintVal = candidate.joinHint ?? 'LEFT';

  // Oracle description 한글 인코딩 처리
  let descriptionVal: string | number = candidate.description;
  if (dbType === 'oracle') {
    sql = buildDescriptionBind(sql, oracleDataCharset);
    if (oracleDataCharset) {
      descriptionVal = encodeForOracle(candidate.description, oracleDataCharset);
    }
  }

  const bindings = [
    candidate.sourceSchema,
    candidate.sourceTable,
    candidate.sourceColumn,
    candidate.targetSchema,
    candidate.targetTable,
    candidate.targetColumn,
    relationshipTypeVal,
    candidate.confidenceLevel,
    joinHintVal,
    descriptionVal,
    isActiveVal,
    createdBy,
  ];

  const result = await knex.raw(sql, bindings);

  switch (dbType) {
    case 'postgresql':
      return (result.rowCount ?? 0) > 0;
    case 'mysql':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      return (result[0]?.affectedRows ?? 0) > 0;
    case 'oracle':
      return (result?.rowsAffected ?? 0) > 0;
  }
}

/**
 * 정규식 특수문자를 이스케이프합니다.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
