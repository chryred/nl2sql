/**
 * NL2SQL 메타데이터 스키마 자동 생성
 *
 * @description
 * 연결된 데이터베이스의 기본 스키마에 메타데이터 테이블을 자동 생성합니다.
 * YAML 설정의 DDL 섹션을 읽어 테이블 존재 여부를 확인한 뒤,
 * 존재하지 않는 테이블만 생성합니다.
 *
 * @module database/metadata/schema-setup
 */

import type { Knex } from 'knex';
import type { DatabaseType } from '../types.js';
import type { DdlTableDefinition } from './types.js';
import { loadMetadataQueries } from './query-loader.js';
import { logger } from '../../logger/index.js';

/**
 * 테이블별 생성 결과
 */
export interface TableSetupResult {
  tableName: string;
  status: 'created' | 'skipped' | 'error';
  message: string;
}

/**
 * 스키마 자동 생성 전체 결과
 */
export interface SchemaSetupResult {
  success: boolean;
  tables: TableSetupResult[];
  summary: string;
}

/**
 * 테이블 존재 여부를 확인합니다.
 *
 * @param knex - Knex 데이터베이스 연결
 * @param dbType - 데이터베이스 타입
 * @param tableName - 확인할 테이블명
 * @returns 테이블이 존재하면 true
 */
async function tableExists(
  knex: Knex,
  dbType: DatabaseType,
  tableName: string
): Promise<boolean> {
  try {
    let query: string;

    switch (dbType) {
      case 'postgresql':
        query = `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${tableName}'`;
        break;
      case 'mysql':
        query = `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${tableName}'`;
        break;
      case 'oracle':
        query = `SELECT 1 FROM user_tables WHERE table_name = UPPER('${tableName}')`;
        break;
      default:
        return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await knex.raw(query);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const rows = dbType === 'oracle' ? result : result.rows || result;
    return Array.isArray(rows) ? rows.length > 0 : false;
  } catch {
    return false;
  }
}

/**
 * 단일 테이블을 생성합니다.
 *
 * @param knex - Knex 데이터베이스 연결
 * @param dbType - 데이터베이스 타입
 * @param tableDef - DDL 테이블 정의
 * @returns 테이블 생성 결과
 */
async function createTable(
  knex: Knex,
  dbType: DatabaseType,
  tableDef: DdlTableDefinition
): Promise<TableSetupResult> {
  const { name, createSql, indexes } = tableDef;

  try {
    // 테이블 존재 확인
    const exists = await tableExists(knex, dbType, name);
    if (exists) {
      return {
        tableName: name,
        status: 'skipped',
        message: 'Table already exists',
      };
    }

    // 테이블 생성
    await knex.raw(createSql);

    // 인덱스 생성
    if (indexes && indexes.length > 0) {
      for (const indexSql of indexes) {
        try {
          await knex.raw(indexSql);
        } catch (indexError) {
          // 인덱스 생성 실패는 경고만 (테이블은 이미 생성됨)
          const msg =
            indexError instanceof Error
              ? indexError.message
              : String(indexError);
          logger.warn(`Index creation warning for ${name}: ${msg}`);
        }
      }
    }

    return {
      tableName: name,
      status: 'created',
      message: 'Table created successfully',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      tableName: name,
      status: 'error',
      message: msg,
    };
  }
}

/**
 * 메타데이터 테이블을 자동 생성합니다.
 *
 * YAML 설정의 DDL 섹션을 읽어 테이블 존재 여부를 확인한 뒤,
 * 존재하지 않는 테이블만 순서대로 생성합니다.
 * (FK 관계가 있으므로 순서가 중요)
 *
 * @param knex - Knex 데이터베이스 연결
 * @param dbType - 데이터베이스 타입
 * @returns 스키마 생성 결과
 */
export async function setupMetadataSchema(
  knex: Knex,
  dbType: DatabaseType
): Promise<SchemaSetupResult> {
  logger.info(`Setting up metadata schema for ${dbType}...`);

  // YAML에서 DDL 설정 로드
  const queryConfig = loadMetadataQueries(dbType);

  if (!queryConfig.ddl || !queryConfig.ddl.tables || queryConfig.ddl.tables.length === 0) {
    return {
      success: false,
      tables: [],
      summary: `No DDL configuration found for ${dbType}`,
    };
  }

  const results: TableSetupResult[] = [];

  // 순서대로 생성 (FK 의존성 때문에 병렬 불가)
  for (const tableDef of queryConfig.ddl.tables) {
    const result = await createTable(knex, dbType, tableDef);
    results.push(result);
    logger.info(`  ${result.status === 'created' ? '+' : result.status === 'skipped' ? '-' : '!'} ${result.tableName}: ${result.message}`);
  }

  const created = results.filter((r) => r.status === 'created').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors = results.filter((r) => r.status === 'error').length;

  const summary = `Setup complete: ${created} created, ${skipped} skipped, ${errors} errors (total: ${results.length} tables)`;
  logger.info(summary);

  return {
    success: errors === 0,
    tables: results,
    summary,
  };
}
