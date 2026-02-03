/**
 * 데이터베이스 연결 관리 모듈
 *
 * @description
 * Knex를 사용하여 데이터베이스 연결을 생성하고 관리합니다.
 * PostgreSQL, MySQL, Oracle 데이터베이스를 지원합니다.
 * 싱글톤 패턴으로 연결을 관리하여 리소스를 효율적으로 사용합니다.
 *
 * @module database/connection
 *
 * @example
 * import { createConnection, testConnection, closeConnection } from './connection';
 *
 * const knex = createConnection(config);
 * if (await testConnection(knex)) {
 *   console.log('Connected successfully');
 * }
 * await closeConnection();
 */

import knex, { Knex } from 'knex';
import type { Config } from '../config/index.js';

/** 싱글톤 데이터베이스 연결 인스턴스 */
let connection: Knex | null = null;

/**
 * 데이터베이스 타입에 맞는 Knex 클라이언트 이름을 반환합니다.
 *
 * @param dbType - 데이터베이스 타입 (postgresql, mysql, oracle)
 * @returns Knex 클라이언트 이름
 * @private
 */
function getKnexClient(dbType: string): string {
  switch (dbType) {
    case 'mysql':
      return 'mysql2';
    case 'oracle':
      return 'oracledb';
    default:
      return 'pg';
  }
}

/**
 * 데이터베이스 타입에 맞는 연결 설정을 생성합니다.
 *
 * @description
 * Oracle의 경우 connectString 형식으로 연결 정보를 구성합니다.
 * PostgreSQL과 MySQL은 표준 host/port/database 형식을 사용합니다.
 *
 * @param config - 애플리케이션 설정 객체
 * @returns Knex 연결 설정 객체
 * @private
 */
function getConnectionConfig(config: Config): Knex.Config['connection'] {
  const dbConfig = config.database;

  if (dbConfig.type === 'oracle') {
    // Oracle connection string format
    const connectString = dbConfig.serviceName
      ? `${dbConfig.host}:${dbConfig.port}/${dbConfig.serviceName}`
      : `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;

    return {
      user: dbConfig.user,
      password: dbConfig.password,
      connectString,
    };
  }

  return {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
  };
}

/**
 * 데이터베이스 연결을 생성합니다.
 *
 * @description
 * 싱글톤 패턴으로 연결을 관리합니다.
 * 이미 연결이 존재하면 기존 연결을 반환합니다.
 * 커넥션 풀은 최소 0개, 최대 5개로 설정됩니다.
 *
 * @param config - 애플리케이션 설정 객체
 * @returns Knex 데이터베이스 연결 인스턴스
 *
 * @example
 * const config = getConfig();
 * const knex = createConnection(config);
 * const result = await knex('users').select('*');
 */
export function createConnection(config: Config): Knex {
  if (connection) {
    return connection;
  }

  const dbConfig = config.database;
  const client = getKnexClient(dbConfig.type);

  connection = knex({
    client,
    connection: getConnectionConfig(config),
    pool: {
      min: 0,
      max: 5,
    },
  });

  return connection;
}

/**
 * 데이터베이스 연결을 테스트합니다.
 *
 * @description
 * 간단한 SELECT 쿼리를 실행하여 연결 상태를 확인합니다.
 * Oracle은 'SELECT 1 FROM DUAL', 그 외는 'SELECT 1'을 사용합니다.
 *
 * @param knexInstance - 테스트할 Knex 연결 인스턴스
 * @returns 연결 성공 여부
 *
 * @example
 * const knex = createConnection(config);
 * const isConnected = await testConnection(knex);
 * if (!isConnected) {
 *   console.error('Database connection failed');
 * }
 */
export async function testConnection(knexInstance: Knex): Promise<boolean> {
  try {
    // Oracle uses 'SELECT 1 FROM DUAL'
    const clientConfig = knexInstance.client.config as { client?: string };
    const testQuery =
      clientConfig.client === 'oracledb'
        ? 'SELECT 1 FROM DUAL'
        : 'SELECT 1';
    await knexInstance.raw(testQuery);
    return true;
  } catch {
    return false;
  }
}

/**
 * 데이터베이스 연결을 종료합니다.
 *
 * @description
 * 싱글톤 연결을 종료하고 참조를 해제합니다.
 * 애플리케이션 종료 시 호출하여 리소스를 정리합니다.
 *
 * @example
 * // 애플리케이션 종료 시
 * await closeConnection();
 * process.exit(0);
 */
export async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.destroy();
    connection = null;
  }
}

/**
 * 현재 데이터베이스 연결을 반환합니다.
 *
 * @description
 * 싱글톤 연결 인스턴스를 반환합니다.
 * 연결이 생성되지 않았으면 null을 반환합니다.
 *
 * @returns 현재 Knex 연결 인스턴스 또는 null
 *
 * @example
 * const knex = getConnection();
 * if (knex) {
 *   // 연결이 존재함
 * }
 */
export function getConnection(): Knex | null {
  return connection;
}
