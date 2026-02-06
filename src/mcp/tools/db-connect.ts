/**
 * DB 연결 도구 (자격 증명 제공)
 *
 * @description
 * 제공된 자격 증명으로 데이터베이스 연결을 테스트합니다.
 * 환경변수 대신 직접 연결 정보를 받아 테스트합니다.
 *
 * @module mcp/tools/db-connect
 */

import { z } from 'zod';
import knex, { Knex } from 'knex';
import { maskSensitiveInfo } from '../../errors/index.js';

/**
 * db_connect 도구의 입력 스키마
 */
export const dbConnectInputSchema = z.object({
  type: z.enum(['postgresql', 'mysql', 'oracle']).describe('Database type'),
  host: z.string().min(1).describe('Database host'),
  port: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Database port (default: auto)'),
  user: z.string().min(1).describe('Database user'),
  password: z.string().describe('Database password'),
  database: z.string().min(1).describe('Database name'),
  serviceName: z.string().optional().describe('Oracle service name (optional)'),
});

export type DbConnectInput = z.infer<typeof dbConnectInputSchema>;

/**
 * db_connect 도구의 출력 인터페이스
 */
export interface DbConnectOutput {
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
 * 데이터베이스 타입에 맞는 Knex 클라이언트 이름을 반환합니다.
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
 * 기본 포트를 반환합니다.
 */
function getDefaultPort(dbType: string): number {
  switch (dbType) {
    case 'mysql':
      return 3306;
    case 'oracle':
      return 1521;
    default:
      return 5432;
  }
}

/**
 * 연결 설정을 생성합니다.
 */
function getConnectionConfig(input: DbConnectInput): Knex.Config['connection'] {
  if (input.type === 'oracle') {
    const port = input.port || getDefaultPort(input.type);
    const connectString = input.serviceName
      ? `${input.host}:${port}/${input.serviceName}`
      : `${input.host}:${port}/${input.database}`;

    return {
      user: input.user,
      password: input.password,
      connectString,
    };
  }

  return {
    host: input.host,
    port: input.port || getDefaultPort(input.type),
    user: input.user,
    password: input.password,
    database: input.database,
  };
}

/**
 * 제공된 자격 증명으로 DB 연결을 테스트합니다.
 *
 * @param input - 연결 자격 증명
 * @returns 연결 테스트 결과
 */
export async function dbConnect(
  input: DbConnectInput
): Promise<DbConnectOutput> {
  const port = input.port || getDefaultPort(input.type);
  let connection: Knex | null = null;

  try {
    const client = getKnexClient(input.type);

    connection = knex({
      client,
      connection: getConnectionConfig(input),
      pool: {
        min: 0,
        max: 1,
      },
      acquireConnectionTimeout: 10000,
    });

    // 연결 테스트 쿼리
    const testQuery =
      input.type === 'oracle' ? 'SELECT 1 FROM DUAL' : 'SELECT 1';
    await connection.raw(testQuery);

    return {
      success: true,
      message: 'Database connection successful',
      details: {
        type: input.type,
        host: input.host,
        port,
        database: input.database,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Connection failed: ${maskSensitiveInfo(message)}`,
      details: {
        type: input.type,
        host: input.host,
        port,
        database: input.database,
      },
    };
  } finally {
    if (connection) {
      await connection.destroy();
    }
  }
}
