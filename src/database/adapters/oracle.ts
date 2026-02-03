/**
 * Oracle 스키마 추출 어댑터
 *
 * @description
 * Oracle 데이터베이스에서 스키마 정보를 추출하는 어댑터입니다.
 * SchemaLoader를 사용하여 YAML에 정의된 쿼리를 실행합니다.
 *
 * @module database/adapters/oracle
 *
 * @example
 * import { extractOracleSchema } from './adapters/oracle';
 *
 * const schema = await extractOracleSchema(knex);
 * console.log(schema.tables);
 */

import type { Knex } from 'knex';
import { SchemaLoader } from '../schema-loader.js';
import type { SchemaInfo } from '../types.js';

/** Oracle용 스키마 로더 인스턴스 */
const loader = new SchemaLoader('oracle');

/**
 * Oracle 데이터베이스의 스키마 정보를 추출합니다.
 *
 * @description
 * Oracle의 ALL_* 데이터 딕셔너리 뷰를 조회하여
 * 접근 가능한 모든 스키마의 테이블, 컬럼, 인덱스, 제약조건 정보를 추출합니다.
 * SYS, SYSTEM 등 시스템 스키마는 자동으로 제외됩니다.
 *
 * @param knex - Knex 데이터베이스 연결 인스턴스 (oracledb 클라이언트)
 * @returns 스키마 정보 (테이블, 컬럼, 인덱스, 제약조건, 최근 쿼리)
 *
 * @example
 * const knex = createConnection(config);
 * const schema = await extractOracleSchema(knex);
 *
 * for (const table of schema.tables) {
 *   console.log(`${table.schemaName}.${table.name}: ${table.columns.length} columns`);
 * }
 */
export async function extractOracleSchema(knex: Knex): Promise<SchemaInfo> {
  return loader.extractSchema(knex);
}
