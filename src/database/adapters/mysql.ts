/**
 * MySQL 스키마 추출 어댑터
 *
 * @description
 * MySQL/MariaDB 데이터베이스에서 스키마 정보를 추출하는 어댑터입니다.
 * SchemaLoader를 사용하여 YAML에 정의된 쿼리를 실행합니다.
 *
 * @module database/adapters/mysql
 *
 * @example
 * import { extractMysqlSchema } from './adapters/mysql';
 *
 * const schema = await extractMysqlSchema(knex);
 * console.log(schema.tables);
 */

import type { Knex } from 'knex';
import { SchemaLoader } from '../schema-loader.js';
import type { SchemaInfo } from '../types.js';

/** MySQL용 스키마 로더 인스턴스 */
const loader = new SchemaLoader('mysql');

/**
 * MySQL 데이터베이스의 스키마 정보를 추출합니다.
 *
 * @description
 * MySQL의 information_schema를 조회하여 연결된 데이터베이스의
 * 테이블, 컬럼, 인덱스, 제약조건 정보를 추출합니다.
 * information_schema, mysql, performance_schema, sys 등
 * 시스템 데이터베이스는 자동으로 제외됩니다.
 *
 * @param knex - Knex 데이터베이스 연결 인스턴스
 * @returns 스키마 정보 (테이블, 컬럼, 인덱스, 제약조건, 최근 쿼리)
 *
 * @example
 * const knex = createConnection(config);
 * const schema = await extractMysqlSchema(knex);
 *
 * for (const table of schema.tables) {
 *   console.log(`${table.schemaName}.${table.name}: ${table.columns.length} columns`);
 * }
 */
export async function extractMysqlSchema(knex: Knex): Promise<SchemaInfo> {
  const dbName = knex.client.config.connection.database as string;
  return loader.extractSchema(knex, dbName);
}
