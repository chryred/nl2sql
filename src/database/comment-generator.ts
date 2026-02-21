/**
 * 코멘트 자동 생성 모듈
 *
 * @description
 * AI를 활용하여 미설정된 테이블/컬럼 코멘트를 자동으로 추론합니다.
 * filterMissingComments로 대상을 추출하고, buildCommentPrompt로
 * AI 프롬프트를 구성하며, parseCommentResponse로 결과를 파싱합니다.
 *
 * @module database/comment-generator
 */

import { loadYaml } from './yaml-loader.js';
import type { Knex } from 'knex';
import type { SchemaInfo } from './schema-extractor.js';
import type {
  MetadataCache,
  GlossaryTerm,
  NamingConvention,
} from './metadata/types.js';
import type { DatabaseType } from './types.js';
import { logger } from '../logger/index.js';
import { encodeForOracle } from './charset-converter.js';

// ─── NL2SQL 메타데이터 테이블 목록 (제외 대상) ───────────────────────────────
const NL2SQL_META_TABLES = [
  'table_relationships',
  'naming_conventions',
  'code_tables',
  'column_code_mappings',
  'code_aliases',
  'glossary_terms',
  'glossary_aliases',
  'glossary_contexts',
  'query_patterns',
  'pattern_parameters',
  'pattern_keywords',
];

/** 기본 배치 크기 (테이블 단위) */
const DEFAULT_BATCH_SIZE = 5;

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

/**
 * 코멘트 대상 필터 옵션
 */
export interface FilterOptions {
  /** 특정 스키마만 대상으로 (선택) */
  schema?: string;
  /** 특정 테이블만 대상으로 (선택, 대소문자 무시) */
  tables?: string[];
}

/**
 * 코멘트가 미설정된 테이블 또는 컬럼 대상
 */
export interface MissingCommentTarget {
  /** 스키마명 */
  schema: string;
  /** 테이블명 */
  table: string;
  /** 컬럼명 (undefined이면 테이블 코멘트 대상) */
  column?: string;
  /** 데이터 타입 (컬럼 대상인 경우) */
  dataType?: string;
  /** 기본키 여부 */
  isPrimaryKey?: boolean;
  /** NULL 허용 여부 */
  isNullable?: boolean;
  /** 외래키 참조 정보 */
  foreignKey?: { refTable: string; refColumn: string } | null;
}

/**
 * AI가 생성한 코멘트 결과
 */
export interface GeneratedComment {
  /** 스키마명 */
  schema: string;
  /** 테이블명 */
  table: string;
  /** 컬럼명 (null이면 테이블 코멘트) */
  column?: string | null;
  /** 생성된 코멘트 */
  comment: string;
}

/**
 * 트렁케이션 정보가 포함된 코멘트 후보
 */
export interface CommentCandidate extends GeneratedComment {
  /** DBMS 길이 제한으로 잘린 경우 true */
  truncated?: boolean;
}

/**
 * 자동 코멘트 생성 결과
 */
export interface AutoCommentResult {
  /** 생성된 코멘트 후보 목록 */
  candidates: CommentCandidate[];
  /** 적용된 코멘트 수 (apply 모드) */
  applied?: number;
  /** 건너뛴 수 (apply 모드) */
  skipped?: number;
  /** 실패 수 (apply 모드) */
  failed?: number;
}

// ─── AI 시스템 프롬프트 ───────────────────────────────────────────────────────

/**
 * 코멘트 생성용 AI 시스템 프롬프트
 */
export const COMMENT_SYSTEM_PROMPT =
  'You are a database documentation expert. Generate concise, accurate comments for database tables and columns based on their physical names, data types, and relationships. Return ONLY a valid JSON array. Each item must have: schema (string), table (string), column (string or null for table comments), comment (string). Be precise and professional. Do not include any explanation outside the JSON array.';

// ─── 핵심 함수 ────────────────────────────────────────────────────────────────

/**
 * 스키마에서 코멘트가 미설정된 테이블/컬럼을 추출합니다.
 *
 * @param schema - 스키마 정보
 * @param options - 필터 옵션 (스키마, 테이블 목록)
 * @returns 코멘트 미설정 대상 목록
 */
export function filterMissingComments(
  schema: SchemaInfo,
  options?: FilterOptions
): MissingCommentTarget[] {
  const targets: MissingCommentTarget[] = [];
  const schemaFilter = options?.schema?.toLowerCase();
  const tableFilter = options?.tables?.map((t) => t.toLowerCase());
  const metaTableSet = new Set(NL2SQL_META_TABLES.map((t) => t.toLowerCase()));

  for (const table of schema.tables) {
    const tableSchema = table.schemaName ?? 'public';
    const tableLower = table.name.toLowerCase();

    // 스키마 필터
    if (schemaFilter && tableSchema.toLowerCase() !== schemaFilter) continue;
    // 테이블 필터
    if (tableFilter && !tableFilter.includes(tableLower)) continue;
    // nl2sql 메타데이터 테이블 제외
    if (metaTableSet.has(tableLower)) continue;

    // 테이블 코멘트 미설정 확인
    if (!table.comment || table.comment.trim() === '') {
      targets.push({
        schema: tableSchema,
        table: table.name,
        column: undefined,
      });
    }

    // 컬럼 코멘트 미설정 확인
    for (const col of table.columns) {
      if (!col.comment || col.comment.trim() === '') {
        targets.push({
          schema: tableSchema,
          table: table.name,
          column: col.name,
          dataType: col.type,
          isPrimaryKey: col.isPrimaryKey,
          isNullable: col.nullable,
          foreignKey: col.references
            ? {
                refTable: col.references.table,
                refColumn: col.references.column,
              }
            : null,
        });
      }
    }
  }

  logger.info(`filterMissingComments: ${targets.length} targets found`);
  return targets;
}

/**
 * 코멘트 생성 AI 프롬프트를 구성합니다.
 *
 * @param targets - 코멘트 미설정 대상 목록
 * @param metadata - 메타데이터 캐시 (용어집, 네이밍 컨벤션)
 * @param dbType - 데이터베이스 타입
 * @returns AI 사용자 프롬프트
 */
export function buildCommentPrompt(
  targets: MissingCommentTarget[],
  metadata: MetadataCache | null,
  dbType: DatabaseType
): string {
  const sections: string[] = [];

  // 테이블 그룹별로 정리
  const tableMap = new Map<
    string,
    { tableTarget?: MissingCommentTarget; columns: MissingCommentTarget[] }
  >();
  for (const t of targets) {
    const key = `${t.schema}.${t.table}`;
    if (!tableMap.has(key)) {
      tableMap.set(key, { columns: [] });
    }
    const entry = tableMap.get(key)!;
    if (!t.column) {
      entry.tableTarget = t;
    } else {
      entry.columns.push(t);
    }
  }

  // 테이블 목록 구성
  const tableLines: string[] = [];
  for (const [key, entry] of tableMap) {
    tableLines.push(`\nTable: ${key}`);
    if (entry.tableTarget) {
      tableLines.push(`  - [TABLE COMMENT NEEDED]`);
    }
    for (const col of entry.columns) {
      const pkStr = col.isPrimaryKey ? ' [PK]' : '';
      const nullStr = col.isNullable ? '' : ' NOT NULL';
      const fkStr = col.foreignKey
        ? ` [FK -> ${col.foreignKey.refTable}.${col.foreignKey.refColumn}]`
        : '';
      tableLines.push(
        `  - ${col.column}: ${col.dataType ?? 'unknown'}${pkStr}${nullStr}${fkStr} [COLUMN COMMENT NEEDED]`
      );
    }
  }
  sections.push(
    `Database type: ${dbType.toUpperCase()}\n\nTables and columns needing comments:${tableLines.join('\n')}`
  );

  // 용어집 컨텍스트 추가
  if (metadata?.glossaryTerms && metadata.glossaryTerms.length > 0) {
    const termLines = metadata.glossaryTerms
      .slice(0, 20)
      .map(
        (t: GlossaryTerm) =>
          `  - "${t.term}": ${t.definition ?? t.sqlCondition}`
      );
    sections.push(
      `Business Glossary (use these definitions as context):\n${termLines.join('\n')}`
    );
  }

  // 네이밍 컨벤션 컨텍스트 추가
  if (metadata?.namingConventions && metadata.namingConventions.length > 0) {
    const convLines = metadata.namingConventions
      .slice(0, 10)
      .map((c: NamingConvention) => `  - "${c.name}": ${c.description ?? ''}`);
    sections.push(`Naming Conventions:\n${convLines.join('\n')}`);
  }

  sections.push(
    'Return JSON array with comments for ALL items listed above. Each item: {"schema":"...","table":"...","column":null_or_column_name,"comment":"..."}. Column null means table comment.'
  );

  return sections.join('\n\n');
}

/**
 * 대상 목록을 테이블 단위로 배치 처리합니다.
 *
 * @param targets - 코멘트 미설정 대상 목록
 * @param batchSize - 배치 당 테이블 수 (기본 5)
 * @returns 배치 배열
 */
export function batchTargets(
  targets: MissingCommentTarget[],
  batchSize = DEFAULT_BATCH_SIZE
): MissingCommentTarget[][] {
  // 테이블 키 순서 유지
  const tableKeys: string[] = [];
  const tableMap = new Map<string, MissingCommentTarget[]>();

  for (const t of targets) {
    const key = `${t.schema}.${t.table}`;
    if (!tableMap.has(key)) {
      tableMap.set(key, []);
      tableKeys.push(key);
    }
    tableMap.get(key)!.push(t);
  }

  const batches: MissingCommentTarget[][] = [];
  for (let i = 0; i < tableKeys.length; i += batchSize) {
    const batch: MissingCommentTarget[] = [];
    for (const key of tableKeys.slice(i, i + batchSize)) {
      batch.push(...tableMap.get(key)!);
    }
    batches.push(batch);
  }
  return batches;
}

/**
 * AI 응답에서 GeneratedComment 배열을 파싱합니다.
 *
 * @param response - AI 응답 문자열
 * @returns 파싱된 코멘트 목록 (유효한 항목만)
 */
export function parseCommentResponse(response: string): GeneratedComment[] {
  let text = response.trim();

  // markdown code block 제거
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // JSON 배열 추출
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logger.warn('parseCommentResponse: no JSON array found in response');
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    logger.warn(`parseCommentResponse: JSON parse failed: ${e}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.warn('parseCommentResponse: parsed result is not an array');
    return [];
  }

  const results: GeneratedComment[] = [];
  for (const item of parsed) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).schema !== 'string' ||
      typeof (item as Record<string, unknown>).table !== 'string' ||
      typeof (item as Record<string, unknown>).comment !== 'string'
    ) {
      logger.warn(
        `parseCommentResponse: skipping invalid item: ${JSON.stringify(item)}`
      );
      continue;
    }
    const col = (item as Record<string, unknown>).column;
    if (col !== null && col !== undefined && typeof col !== 'string') {
      logger.warn(
        `parseCommentResponse: skipping item with invalid column field: ${JSON.stringify(item)}`
      );
      continue;
    }
    results.push({
      schema: (item as Record<string, unknown>).schema as string,
      table: (item as Record<string, unknown>).table as string,
      column: col as string | null,
      comment: (item as Record<string, unknown>).comment as string,
    });
  }

  return results;
}

// ─── 코멘트 길이 제한 설정 ────────────────────────────────────────────────────

const ORACLE_BYTE_LIMIT = 4000;

/** MySQL 문자 수 제한 (테이블/컬럼) */
const CHAR_LIMITS: Record<DatabaseType, { table: number; column: number } | null> = {
  postgresql: null,
  mysql: { table: 2048, column: 1024 },
  oracle: null,
};

/**
 * 바이트 단위로 문자열을 잘라냅니다 (Oracle 전용).
 */
function truncateByBytes(
  comment: string,
  limit: number
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(comment, 'utf8') <= limit) {
    return { text: comment, truncated: false };
  }
  let byteCount = 0;
  let charIdx = 0;
  while (charIdx < comment.length) {
    const charBytes = Buffer.byteLength(comment[charIdx], 'utf8');
    if (byteCount + charBytes > limit) break;
    byteCount += charBytes;
    charIdx++;
  }
  return { text: comment.slice(0, charIdx), truncated: true };
}

/**
 * DBMS별 코멘트 길이 제한을 적용합니다.
 *
 * @param comment - 원본 코멘트 문자열
 * @param dbType - 데이터베이스 타입
 * @param isTable - 테이블 코멘트 여부 (false = 컬럼 코멘트)
 * @returns 트렁케이션 결과 { text, truncated }
 */
export function truncateComment(
  comment: string,
  dbType: DatabaseType,
  isTable: boolean
): { text: string; truncated: boolean } {
  if (dbType === 'oracle') return truncateByBytes(comment, ORACLE_BYTE_LIMIT);
  const limits = CHAR_LIMITS[dbType];
  if (!limits) return { text: comment, truncated: false };
  const limit = isTable ? limits.table : limits.column;
  if (comment.length <= limit) return { text: comment, truncated: false };
  return { text: comment.slice(0, limit), truncated: true };
}

// ─── DBMS별 SQL 빌더 ──────────────────────────────────────────────────────────

// ─── 코멘트 SQL 템플릿 로더 ───────────────────────────────────────────────────

/**
 * YAML에서 로드하는 코멘트 SQL 템플릿 구조
 */
interface CommentSQLTemplates {
  getColumnDef?: { sql: string };
  commentOnTable: { sql: string };
  commentOnColumn: { sql: string };
  commentOnTableWithCharset?: { sql: string };
  commentOnColumnWithCharset?: { sql: string };
}

/**
 * DBMS별 코멘트 SQL 템플릿을 YAML에서 로드합니다 (yaml-loader 캐시 공유).
 */
function loadCommentSQL(dbType: DatabaseType): CommentSQLTemplates {
  return loadYaml<{ comments: CommentSQLTemplates }>(
    `schemas/${dbType}.yaml`
  ).comments;
}

/**
 * SQL 템플릿의 `{key}` 식별자 플레이스홀더를 치환합니다.
 */
function applyTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return Object.entries(vars).reduce(
    (sql, [key, val]) => sql.split(`{${key}}`).join(val),
    template
  );
}

/**
 * MySQL 컬럼 정의 정보
 */
interface MySQLColumnDef {
  columnType: string;
  isNullable: string;
  columnDefault: string | null;
  extra: string;
}

/**
 * MySQL INFORMATION_SCHEMA에서 컬럼 정의를 조회합니다.
 *
 * @param knex - Knex 인스턴스
 * @param schema - 스키마명
 * @param table - 테이블명
 * @param column - 컬럼명
 * @returns 컬럼 정의 또는 null
 */
async function getColumnDefinition(
  knex: Knex,
  schema: string,
  table: string,
  column: string
): Promise<MySQLColumnDef | null> {
  const templates = loadCommentSQL('mysql');
  if (!templates.getColumnDef) {
    throw new Error('getColumnDef SQL not found in mysql.yaml');
  }
  const result = await knex.raw(templates.getColumnDef.sql, [
    schema,
    table,
    column,
  ]);
  // MySQL knex.raw returns [rows, fields]
  const rows = result[0] as Array<{
    COLUMN_TYPE: string;
    IS_NULLABLE: string;
    COLUMN_DEFAULT: string | null;
    EXTRA: string;
  }>;
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return {
    columnType: row.COLUMN_TYPE,
    isNullable: row.IS_NULLABLE,
    columnDefault: row.COLUMN_DEFAULT,
    extra: row.EXTRA,
  };
}

function buildPostgresCommentSQL(
  candidate: CommentCandidate,
  templates: CommentSQLTemplates
): { sql: string; bindings: unknown[] } {
  const isColumn = candidate.column != null && candidate.column !== '';
  const tmpl = isColumn ? templates.commentOnColumn : templates.commentOnTable;
  const sql = applyTemplate(tmpl.sql, {
    schema: candidate.schema,
    table: candidate.table,
    ...(isColumn ? { column: candidate.column as string } : {}),
  });
  return { sql, bindings: [candidate.comment] };
}

function buildMysqlCommentSQL(
  candidate: CommentCandidate,
  templates: CommentSQLTemplates,
  mysqlColumnDef?: MySQLColumnDef | null
): { sql: string; bindings: unknown[] } {
  const isColumn = candidate.column != null && candidate.column !== '';
  if (isColumn) {
    if (!mysqlColumnDef) {
      throw new Error(
        `MySQL column definition not available for ${candidate.schema}.${candidate.table}.${candidate.column}`
      );
    }
    const nullPart = mysqlColumnDef.isNullable === 'NO' ? 'NOT NULL' : 'NULL';
    const defaultPart =
      mysqlColumnDef.columnDefault !== null
        ? ` DEFAULT '${mysqlColumnDef.columnDefault.replace(/'/g, "''")}'`
        : '';
    const extraPart = mysqlColumnDef.extra ? ` ${mysqlColumnDef.extra}` : '';
    const sql = applyTemplate(templates.commentOnColumn.sql, {
      schema: candidate.schema,
      table: candidate.table,
      column: candidate.column as string,
      columnType: mysqlColumnDef.columnType,
      nullPart,
      defaultPart,
      extraPart,
    });
    return { sql, bindings: [candidate.comment] };
  }
  const sql = applyTemplate(templates.commentOnTable.sql, {
    schema: candidate.schema,
    table: candidate.table,
  });
  return { sql, bindings: [candidate.comment] };
}

function buildOracleCommentSQL(
  candidate: CommentCandidate,
  templates: CommentSQLTemplates,
  oracleDataCharset?: string
): { sql: string; bindings: unknown[] } {
  const isColumn = candidate.column != null && candidate.column !== '';
  const schemaUpper = candidate.schema.toUpperCase();
  const tableUpper = candidate.table.toUpperCase();

  if (oracleDataCharset) {
    const hexComment = encodeForOracle(candidate.comment, oracleDataCharset);
    if (isColumn) {
      const colUpper = (candidate.column as string).toUpperCase();
      const tmpl = templates.commentOnColumnWithCharset;
      if (!tmpl)
        throw new Error('commentOnColumnWithCharset SQL not found in oracle.yaml');
      const sql = applyTemplate(tmpl.sql, {
        schema: schemaUpper,
        table: tableUpper,
        column: colUpper,
      });
      return { sql, bindings: [hexComment] };
    }
    const tmpl = templates.commentOnTableWithCharset;
    if (!tmpl)
      throw new Error('commentOnTableWithCharset SQL not found in oracle.yaml');
    const sql = applyTemplate(tmpl.sql, { schema: schemaUpper, table: tableUpper });
    return { sql, bindings: [hexComment] };
  }

  const tmpl = isColumn ? templates.commentOnColumn : templates.commentOnTable;
  const sql = applyTemplate(tmpl.sql, {
    schema: schemaUpper,
    table: tableUpper,
    ...(isColumn ? { column: (candidate.column as string).toUpperCase() } : {}),
  });
  return { sql, bindings: [candidate.comment] };
}

type CommentSQLBuilderFn = (
  candidate: CommentCandidate,
  templates: CommentSQLTemplates,
  oracleDataCharset?: string,
  mysqlColumnDef?: MySQLColumnDef | null
) => { sql: string; bindings: unknown[] };

// 각 빌더는 (candidate, templates, oracleDataCharset?, mysqlColumnDef?)를 받지만
// 자신의 DBMS에 해당하는 파라미터만 사용합니다.
const COMMENT_SQL_BUILDERS: Record<DatabaseType, CommentSQLBuilderFn> = {
  postgresql: (c, t) => buildPostgresCommentSQL(c, t),
  mysql: (c, t, _charset, colDef) => buildMysqlCommentSQL(c, t, colDef),
  oracle: (c, t, charset) => buildOracleCommentSQL(c, t, charset),
};

/**
 * DBMS별 COMMENT SQL과 바인딩을 생성합니다.
 *
 * @param candidate - 코멘트 후보
 * @param dbType - 데이터베이스 타입
 * @param oracleDataCharset - Oracle 데이터 캐릭터셋 (한글 처리용)
 * @param mysqlColumnDef - MySQL 컬럼 정의 (컬럼 코멘트 시 필요)
 * @returns SQL 문자열과 바인딩 배열
 */
export function buildCommentSQL(
  candidate: CommentCandidate,
  dbType: DatabaseType,
  oracleDataCharset?: string,
  mysqlColumnDef?: MySQLColumnDef | null
): { sql: string; bindings: unknown[] } {
  const templates = loadCommentSQL(dbType);
  return COMMENT_SQL_BUILDERS[dbType](candidate, templates, oracleDataCharset, mysqlColumnDef);
}

/**
 * mysql/oracle 공통: 개별 실행 + 에러 카운트
 */
async function applyOneByOne(
  knex: Knex,
  dbType: DatabaseType,
  candidates: CommentCandidate[],
  oracleDataCharset?: string
): Promise<{ applied: number; skipped: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      let mysqlColDef: MySQLColumnDef | null = null;
      if (dbType === 'mysql' && candidate.column != null && candidate.column !== '') {
        mysqlColDef = await getColumnDefinition(
          knex,
          candidate.schema,
          candidate.table,
          candidate.column
        );
      }
      const { sql, bindings } = buildCommentSQL(
        candidate,
        dbType,
        oracleDataCharset,
        mysqlColDef
      );
      await knex.raw(sql, bindings);
      applied++;
    } catch (e) {
      logger.warn(
        `applyComments: ${dbType} failed for ${candidate.schema}.${candidate.table}.${candidate.column ?? ''}: ${e}`
      );
      failed++;
    }
  }
  return { applied, skipped: 0, failed };
}

/**
 * 코멘트 후보를 DB에 적용합니다.
 *
 * @param knex - Knex 인스턴스
 * @param dbType - 데이터베이스 타입
 * @param candidates - 코멘트 후보 목록
 * @param oracleDataCharset - Oracle 데이터 캐릭터셋 (한글 처리용)
 * @returns 적용/건너뜀/실패 카운트
 */
export async function applyComments(
  knex: Knex,
  dbType: DatabaseType,
  candidates: CommentCandidate[],
  oracleDataCharset?: string
): Promise<{ applied: number; skipped: number; failed: number }> {
  if (candidates.length === 0) return { applied: 0, skipped: 0, failed: 0 };

  if (dbType === 'postgresql') {
    let applied = 0;
    let failed = 0;
    try {
      await knex.transaction(async (trx) => {
        for (const candidate of candidates) {
          const { sql, bindings } = buildCommentSQL(candidate, 'postgresql');
          await trx.raw(sql, bindings);
          applied++;
        }
      });
    } catch (e) {
      logger.warn(`applyComments: PostgreSQL transaction failed: ${e}`);
      // 트랜잭션 롤백으로 실제 커밋된 것 없음
      failed = candidates.length;
      applied = 0;
    }
    return { applied, skipped: 0, failed };
  }

  return applyOneByOne(knex, dbType, candidates, oracleDataCharset);
}
