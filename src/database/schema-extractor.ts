/**
 * 스키마 추출 및 포맷팅 모듈
 *
 * @description
 * 데이터베이스 스키마를 추출하고 다양한 형식으로 포맷팅하는 기능을 제공합니다.
 * AI 프롬프트 생성을 위한 텍스트 형식 변환 기능을 포함합니다.
 *
 * @module database/schema-extractor
 *
 * @example
 * import { extractSchema, formatSchemaForPrompt } from './schema-extractor';
 *
 * const schema = await extractSchema(knex, config);
 * const promptText = formatSchemaForPrompt(schema);
 */

import type { Knex } from 'knex';
import type { Config } from '../config/index.js';
import { extractPostgresSchema } from './adapters/postgresql.js';
import { extractMysqlSchema } from './adapters/mysql.js';
import { extractOracleSchema } from './adapters/oracle.js';
import type { SchemaInfo, ExtendedTableInfo } from './types.js';

// Re-export types for backward compatibility
export type {
  SchemaInfo,
  ExtendedTableInfo as TableInfo,
  ExtendedColumnInfo as ColumnInfo,
} from './types.js';

/**
 * 데이터베이스 스키마 정보를 추출합니다.
 *
 * @description
 * 설정된 데이터베이스 타입에 따라 적절한 어댑터를 선택하여
 * 스키마 정보를 추출합니다. PostgreSQL, MySQL, Oracle을 지원합니다.
 *
 * @param knex - Knex 데이터베이스 연결 인스턴스
 * @param config - 애플리케이션 설정 객체
 * @returns 테이블, 컬럼, 인덱스 정보가 포함된 스키마 정보
 *
 * @example
 * const config = getConfig();
 * const knex = createConnection(config);
 * const schema = await extractSchema(knex, config);
 * console.log(`Found ${schema.tables.length} tables`);
 */
export async function extractSchema(
  knex: Knex,
  config: Config
): Promise<SchemaInfo> {
  switch (config.database.type) {
    case 'mysql':
      return extractMysqlSchema(knex);
    case 'oracle':
      return extractOracleSchema(knex);
    default:
      return extractPostgresSchema(knex);
  }
}

/**
 * 스키마 정보를 AI 프롬프트용 텍스트로 포맷팅합니다.
 *
 * @description
 * 스키마 정보를 사람이 읽기 쉬운 텍스트 형식으로 변환합니다.
 * 테이블명, 컬럼 정보, 인덱스, 최근 쿼리 패턴 등을 포함합니다.
 * 이 텍스트는 AI 모델에게 데이터베이스 구조를 설명하는 데 사용됩니다.
 *
 * @param schema - 스키마 정보 또는 테이블 정보 배열
 * @returns 포맷팅된 스키마 텍스트
 *
 * @example
 * const schema = await extractSchema(knex, config);
 * const promptText = formatSchemaForPrompt(schema);
 * // Output:
 * // Table: users -- 사용자 정보
 * // Columns:
 * //   - id: integer [PK, NOT NULL]
 * //   - email: varchar [NOT NULL]
 */
export function formatSchemaForPrompt(
  schema: SchemaInfo | ExtendedTableInfo[]
): string {
  const tables = Array.isArray(schema) ? schema : schema.tables;
  const recentQueries = Array.isArray(schema)
    ? undefined
    : schema.recentQueries;
  const lines: string[] = [];

  for (const table of tables) {
    // Table header with comment (include schema name if available)
    const schemaPrefix = table.schemaName ? `${table.schemaName}.` : '';
    const tableComment = table.comment ? ` -- ${table.comment}` : '';
    lines.push(`Table: ${schemaPrefix}${table.name}${tableComment}`);
    lines.push('Columns:');

    for (const col of table.columns) {
      const flags: string[] = [];
      if (col.isPrimaryKey) flags.push('PK');
      if (col.isForeignKey && col.references) {
        const refSchema = col.references.schema
          ? `${col.references.schema}.`
          : '';
        flags.push(
          `FK -> ${refSchema}${col.references.table}.${col.references.column}`
        );
      }
      if (!col.nullable) flags.push('NOT NULL');

      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
      const commentStr = col.comment ? ` -- ${col.comment}` : '';
      lines.push(`  - ${col.name}: ${col.type}${flagStr}${commentStr}`);
    }

    // Show indexes
    if (table.indexes && table.indexes.length > 0) {
      lines.push('Indexes:');
      for (const idx of table.indexes) {
        const uniqueStr = idx.unique ? ' (UNIQUE)' : '';
        lines.push(`  - ${idx.name}: [${idx.columns.join(', ')}]${uniqueStr}`);
      }
    }

    lines.push('');
  }

  // Add recent query patterns if available
  if (recentQueries && recentQueries.length > 0) {
    lines.push('Recent Query Patterns:');
    for (const q of recentQueries.slice(0, 5)) {
      const truncatedQuery =
        q.query.length > 100 ? q.query.substring(0, 100) + '...' : q.query;
      lines.push(`  - (${q.callCount} calls) ${truncatedQuery}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 인덱스 정보를 프롬프트용 텍스트로 포맷팅합니다.
 *
 * @description
 * 테이블의 인덱스 정보만 추출하여 텍스트로 변환합니다.
 * AI 모델이 쿼리 최적화를 위해 인덱스를 고려할 수 있도록 합니다.
 *
 * @param tables - 테이블 정보 배열
 * @returns 포맷팅된 인덱스 정보 텍스트 (인덱스가 없으면 빈 문자열)
 *
 * @example
 * const indexText = formatIndexesForPrompt(schema.tables);
 * // Output:
 * // Available Indexes:
 * //   users.idx_email: [email] (UNIQUE)
 * //   orders.idx_user_date: [user_id, created_at]
 */
export function formatIndexesForPrompt(tables: ExtendedTableInfo[]): string {
  const lines: string[] = ['Available Indexes:'];

  for (const table of tables) {
    if (table.indexes && table.indexes.length > 0) {
      const schemaPrefix = table.schemaName ? `${table.schemaName}.` : '';
      for (const idx of table.indexes) {
        const uniqueStr = idx.unique ? ' (UNIQUE)' : '';
        lines.push(
          `  ${schemaPrefix}${table.name}.${idx.name}: [${idx.columns.join(', ')}]${uniqueStr}`
        );
      }
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}
