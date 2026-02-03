/**
 * DB 연결 테스트 도구
 *
 * @description
 * 환경변수에 설정된 데이터베이스 연결을 테스트합니다.
 * 파라미터 없이 현재 설정된 DB에 연결 가능한지 확인합니다.
 *
 * @module mcp/tools/db-test
 */

import { z } from 'zod';
import { getConfig, validateConfig, type Config } from '../../config/index.js';
import { createConnection, testConnection, closeConnection } from '../../database/connection.js';
import { maskSensitiveInfo } from '../../errors/index.js';

/**
 * db_test_connection 도구의 입력 스키마
 * 파라미터 없음
 */
export const dbTestInputSchema = z.object({});

export type DbTestInput = z.infer<typeof dbTestInputSchema>;

/**
 * db_test_connection 도구의 출력 인터페이스
 */
export interface DbTestOutput {
  success: boolean;
  message: string;
  details?: {
    type: string;
    host: string;
    port: number;
    database: string;
  };
}

/**
 * 환경변수에 설정된 DB 연결을 테스트합니다.
 *
 * @returns 연결 테스트 결과
 */
export async function dbTestConnection(): Promise<DbTestOutput> {
  let config: Config;

  try {
    config = getConfig();
    validateConfig(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown configuration error';
    return {
      success: false,
      message: `Configuration error: ${maskSensitiveInfo(message)}`,
    };
  }

  try {
    const knex = createConnection(config);
    const connected = await testConnection(knex);

    if (connected) {
      return {
        success: true,
        message: 'Database connection successful',
        details: {
          type: config.database.type,
          host: config.database.host,
          port: config.database.port,
          database: config.database.database,
        },
      };
    } else {
      return {
        success: false,
        message: 'Database connection test failed',
        details: {
          type: config.database.type,
          host: config.database.host,
          port: config.database.port,
          database: config.database.database,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Connection error: ${maskSensitiveInfo(message)}`,
    };
  } finally {
    await closeConnection();
  }
}
