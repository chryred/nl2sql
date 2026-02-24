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
  InferenceQueryDefinition,
} from './types.js';
import { loadMetadataQueries, mapQueryResults } from './query-loader.js';
import { encodeForOracle } from '../charset-converter.js';
import { logger } from '../../logger/index.js';

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
}

/**
 * 추론 결과
 */
export interface InferenceResult {
  candidates: InferredRelationship[];
  applied?: number;
  skipped?: number;
}

/**
 * DB 컬럼 정보 (information_schema에서 조회)
 */
interface ColumnInfo {
  tableSchema: string;
  tableName: string;
  columnName: string;
  dataType: string;
}

/**
 * PK/UK 컬럼 정보
 */
interface ConstraintColumnInfo {
  tableSchema: string;
  tableName: string;
  columnName: string;
  constraintType: string;
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

// =============================================================================
// YAML 기반 쿼리 헬퍼
// =============================================================================

/**
 * {{SCHEMA_FILTER}} 플레이스홀더를 런타임 조건으로 치환합니다.
 *
 * @param queryDef - 추론 쿼리 정의
 * @param schema - 필터링할 스키마 (없으면 시스템 스키마 제외)
 * @returns 치환된 SQL과 바인딩 배열
 */
export function buildSchemaFilter(
  queryDef: InferenceQueryDefinition,
  schema?: string
): { sql: string; bindings: string[] } {
  const systemSchemas = queryDef.systemSchemas ?? [];
  const filterCol = queryDef.schemaFilterColumn ?? 'table_schema';
  const bindings: string[] = [];

  let filterClause: string;
  if (schema) {
    filterClause = `AND ${filterCol} = ?`;
    bindings.push(schema);
  } else {
    filterClause = `AND ${filterCol} NOT IN (${systemSchemas.map(() => '?').join(',')})`;
    bindings.push(...systemSchemas);
  }

  const sql = queryDef.sql.replace('{{SCHEMA_FILTER}}', filterClause);
  return { sql, bindings };
}

/**
 * Oracle upsert에서 {{DESCRIPTION_BIND}} 플레이스홀더를 처리합니다.
 *
 * @param sql - 원본 SQL
 * @param oracleDataCharset - Oracle 데이터 캐릭터셋 (있으면 UTL_RAW 적용)
 * @returns 치환된 SQL
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

/**
 * 사용자 테이블의 컬럼 정보를 조회합니다.
 */
async function fetchColumns(
  knex: Knex,
  dbType: DatabaseType,
  schema?: string
): Promise<ColumnInfo[]> {
  const config = loadMetadataQueries(dbType);
  const queryDef = config.queries.inferenceColumns;
  if (!queryDef) {
    throw new Error(`inferenceColumns query not defined for ${dbType}`);
  }

  const { sql, bindings } = buildSchemaFilter(
    queryDef,
    schema
  );
  const result = await knex.raw(sql, bindings);
  const rows: Record<string, unknown>[] =
    dbType === 'oracle' ? result : (result.rows ?? result);

  return mapQueryResults<ColumnInfo>(
    Array.isArray(rows) ? rows : [],
    queryDef.mapping
  );
}

/**
 * PK/UK 제약조건이 있는 컬럼을 조회합니다.
 */
async function fetchConstraintColumns(
  knex: Knex,
  dbType: DatabaseType,
  schema?: string
): Promise<ConstraintColumnInfo[]> {
  const config = loadMetadataQueries(dbType);
  const queryDef = config.queries.inferenceConstraints;
  if (!queryDef) {
    throw new Error(`inferenceConstraints query not defined for ${dbType}`);
  }

  const { sql, bindings } = buildSchemaFilter(
    queryDef,
    schema
  );
  const result = await knex.raw(sql, bindings);
  const rows: Record<string, unknown>[] =
    dbType === 'oracle' ? result : (result.rows ?? result);

  return mapQueryResults<ConstraintColumnInfo>(
    Array.isArray(rows) ? rows : [],
    queryDef.mapping
  );
}

// =============================================================================
// 추론 핵심 로직
// =============================================================================

/**
 * 테이블 존재 여부를 빠르게 확인하기 위한 Set을 구축합니다.
 */
function buildTableSet(
  columns: ColumnInfo[]
): Map<string, Set<string>> {
  const schemaMap = new Map<string, Set<string>>();
  for (const col of columns) {
    const key = col.tableSchema.toLowerCase();
    if (!schemaMap.has(key)) {
      schemaMap.set(key, new Set());
    }
    schemaMap.get(key)!.add(col.tableName.toLowerCase());
  }
  return schemaMap;
}

/**
 * 컬럼 존재 여부를 빠르게 확인하기 위한 Set을 구축합니다.
 */
function buildColumnSet(
  columns: ColumnInfo[]
): Set<string> {
  const set = new Set<string>();
  for (const col of columns) {
    set.add(
      `${col.tableSchema.toLowerCase()}.${col.tableName.toLowerCase()}.${col.columnName.toLowerCase()}`
    );
  }
  return set;
}

/**
 * PK/UK Set을 구축합니다.
 */
function buildConstraintSet(
  constraints: ConstraintColumnInfo[]
): Set<string> {
  const set = new Set<string>();
  for (const c of constraints) {
    set.add(
      `${c.tableSchema.toLowerCase()}.${c.tableName.toLowerCase()}.${c.columnName.toLowerCase()}`
    );
  }
  return set;
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
  columns: ColumnInfo[],
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

    for (const col of columns) {
      // 스키마 필터
      if (
        conv.applyToSchemas &&
        conv.applyToSchemas.length > 0 &&
        !conv.applyToSchemas.some(
          (s) => s.toLowerCase() === col.tableSchema.toLowerCase()
        )
      ) {
        continue;
      }

      // 테이블 제외 필터
      if (
        conv.excludeTables &&
        conv.excludeTables.some(
          (t) => t.toLowerCase() === col.tableName.toLowerCase()
        )
      ) {
        continue;
      }

      const match = col.columnName.match(regex);
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
        col.tableSchema,
        tableSet,
        conv.applyPluralization
      );
      if (!actualTable) continue;

      // 타겟 컬럼 존재 확인
      const targetColKey = `${col.tableSchema.toLowerCase()}.${actualTable.toLowerCase()}.${candidateColumn.toLowerCase()}`;
      if (!columnSet.has(targetColKey)) continue;

      // 자기 참조 제외 (같은 테이블, 같은 컬럼)
      if (
        col.tableName.toLowerCase() === actualTable.toLowerCase() &&
        col.columnName.toLowerCase() === candidateColumn.toLowerCase()
      ) {
        continue;
      }

      // 중복 확인
      const relKey =
        `${col.tableSchema.toLowerCase()}.${col.tableName.toLowerCase()}.${col.columnName.toLowerCase()}` +
        `→${col.tableSchema.toLowerCase()}.${actualTable.toLowerCase()}.${candidateColumn.toLowerCase()}`;

      if (existingSet.has(relKey) || seen.has(relKey)) continue;
      seen.add(relKey);

      candidates.push({
        sourceSchema: col.tableSchema,
        sourceTable: col.tableName,
        sourceColumn: col.columnName,
        targetSchema: col.tableSchema,
        targetTable: actualTable,
        targetColumn: candidateColumn,
        confidenceLevel: 'MEDIUM',
        inferenceType: 'naming_convention',
        matchedPattern: conv.name,
        description: `네이밍 컨벤션 '${conv.name}' 기반 추론: ${col.columnName} → ${actualTable}.${candidateColumn}`,
      });
    }
  }

  return candidates;
}

/**
 * 동일 컬럼명 기반으로 관계를 추론합니다.
 *
 * @param columns - DB 컬럼 목록
 * @param existingSet - 기존 관계 Set
 * @param constraintSet - PK/UK 제약조건 Set
 * @returns 추론된 관계 후보
 */
function inferByColumnMatch(
  columns: ColumnInfo[],
  existingSet: Set<string>,
  constraintSet: Set<string>
): InferredRelationship[] {
  const candidates: InferredRelationship[] = [];
  const seen = new Set<string>();

  // 컬럼명으로 그룹화
  const columnGroups = new Map<string, ColumnInfo[]>();
  for (const col of columns) {
    const key = col.columnName.toLowerCase();
    if (!columnGroups.has(key)) {
      columnGroups.set(key, []);
    }
    columnGroups.get(key)!.push(col);
  }

  for (const [, group] of columnGroups) {
    // 2개 이상 테이블에 존재하는 컬럼만
    if (group.length < 2) continue;

    // PK/UK를 가진 컬럼과 아닌 컬럼을 분리
    const pkSide: ColumnInfo[] = [];
    const fkSide: ColumnInfo[] = [];

    for (const col of group) {
      const key = `${col.tableSchema.toLowerCase()}.${col.tableName.toLowerCase()}.${col.columnName.toLowerCase()}`;
      if (constraintSet.has(key)) {
        pkSide.push(col);
      } else {
        fkSide.push(col);
      }
    }

    // PK가 있는 쪽과 FK 쪽을 매핑
    for (const fk of fkSide) {
      for (const pk of pkSide) {
        // 같은 테이블 제외
        if (
          fk.tableSchema.toLowerCase() === pk.tableSchema.toLowerCase() &&
          fk.tableName.toLowerCase() === pk.tableName.toLowerCase()
        ) {
          continue;
        }

        // 데이터 타입 호환성 확인 (동일 타입만)
        if (fk.dataType.toLowerCase() !== pk.dataType.toLowerCase()) continue;

        const relKey =
          `${fk.tableSchema.toLowerCase()}.${fk.tableName.toLowerCase()}.${fk.columnName.toLowerCase()}` +
          `→${pk.tableSchema.toLowerCase()}.${pk.tableName.toLowerCase()}.${pk.columnName.toLowerCase()}`;

        if (existingSet.has(relKey) || seen.has(relKey)) continue;
        seen.add(relKey);

        candidates.push({
          sourceSchema: fk.tableSchema,
          sourceTable: fk.tableName,
          sourceColumn: fk.columnName,
          targetSchema: pk.tableSchema,
          targetTable: pk.tableName,
          targetColumn: pk.columnName,
          confidenceLevel: 'LOW',
          inferenceType: 'column_match',
          description: `동일 컬럼명 기반 추론: ${fk.tableName}.${fk.columnName} → ${pk.tableName}.${pk.columnName}`,
        });
      }
    }
  }

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
  knex: Knex,
  dbType: DatabaseType,
  namingConventions: NamingConvention[],
  existingRelationships: TableRelationship[],
  options?: InferenceOptions
): Promise<InferredRelationship[]> {
  const types = options?.types ?? ['naming_convention', 'column_match'];

  logger.info(
    `Starting relationship inference (types: ${types.join(', ')}, schema: ${options?.schema ?? 'all'})`
  );

  // DB에서 컬럼 정보 조회
  const columns = await fetchColumns(knex, dbType, options?.schema);
  logger.info(`Fetched ${columns.length} columns from ${dbType}`);

  if (columns.length === 0) {
    return [];
  }

  // 인덱스 구조 구축
  const tableSet = buildTableSet(columns);
  const columnSet = buildColumnSet(columns);
  const existingSet = buildExistingRelationshipSet(existingRelationships);

  const allCandidates: InferredRelationship[] = [];

  // 1) 네이밍 컨벤션 기반 추론
  if (types.includes('naming_convention') && namingConventions.length > 0) {
    const ncCandidates = inferByNamingConvention(
      columns,
      namingConventions,
      existingSet,
      tableSet,
      columnSet
    );
    logger.info(
      `Naming convention inference: ${ncCandidates.length} candidates`
    );
    allCandidates.push(...ncCandidates);

    // 네이밍 컨벤션 결과도 existing에 추가 (5단계에서 중복 방지)
    for (const c of ncCandidates) {
      existingSet.add(
        `${c.sourceSchema.toLowerCase()}.${c.sourceTable.toLowerCase()}.${c.sourceColumn.toLowerCase()}` +
          `→${c.targetSchema.toLowerCase()}.${c.targetTable.toLowerCase()}.${c.targetColumn.toLowerCase()}`
      );
    }
  }

  // 2) 동일 컬럼명 기반 추론
  if (types.includes('column_match')) {
    const constraintColumns = await fetchConstraintColumns(
      knex,
      dbType,
      options?.schema
    );
    const constraintSet = buildConstraintSet(constraintColumns);

    const cmCandidates = inferByColumnMatch(
      columns,
      existingSet,
      constraintSet
    );
    logger.info(`Column match inference: ${cmCandidates.length} candidates`);
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
