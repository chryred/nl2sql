/**
 * PostgreSQL 스키마 추출 어댑터
 *
 * @description
 * PostgreSQL 데이터베이스에서 스키마 정보를 추출하는 어댑터입니다.
 * SchemaLoader를 사용하여 YAML에 정의된 쿼리를 실행합니다.
 *
 * @module database/adapters/postgresql
 *
 * @example
 * import { extractPostgresSchema } from './adapters/postgresql';
 *
 * const schema = await extractPostgresSchema(knex);
 * console.log(schema.tables);
 */

import type { Knex } from 'knex';
import { SchemaLoader } from '../schema-loader.js';
import type { SchemaInfo, ExtendedColumnInfo, ExtendedTableInfo } from '../types.js';

// Re-export types for backward compatibility
export type ColumnInfo = ExtendedColumnInfo;
export type TableInfo = ExtendedTableInfo;

/** PostgreSQL용 스키마 로더 인스턴스 */
const loader = new SchemaLoader('postgresql');

/**
 * PostgreSQL 데이터베이스의 스키마 정보를 추출합니다.
 *
 * @description
 * PostgreSQL의 information_schema와 시스템 카탈로그를 조회하여
 * 모든 사용자 스키마의 테이블, 컬럼, 인덱스, 제약조건 정보를 추출합니다.
 * pg_catalog, information_schema 등 시스템 스키마는 자동으로 제외됩니다.
 *
 * @param knex - Knex 데이터베이스 연결 인스턴스
 * @returns 스키마 정보 (테이블, 컬럼, 인덱스, 제약조건, 최근 쿼리)
 *
 * @example
 * const knex = createConnection(config);
 * const schema = await extractPostgresSchema(knex);
 *
 * for (const table of schema.tables) {
 *   console.log(`${table.schemaName}.${table.name}: ${table.columns.length} columns`);
 * }
 */
export async function extractPostgresSchema(knex: Knex): Promise<SchemaInfo> {
  return loader.extractSchema(knex);
}
