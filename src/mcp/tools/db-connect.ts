/**
 * DB 연결 도구 (자격 증명 제공)
 *
 * @description
 * 제공된 자격 증명으로 데이터베이스 연결을 테스트하고 등록합니다.
 * 반환된 connectionId를 후속 도구 호출에서 사용합니다.
 *
 * @module mcp/tools/db-connect
 */

import { z } from 'zod';
import { maskSensitiveInfo } from '../../errors/index.js';
import type { ConnectionManager } from '../../database/connection-manager.js';
import { initializeOracleDriver } from '../../database/oracle-driver-setup.js';

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
  oracleDataCharset: z
    .string()
    .optional()
    .describe(
      'Data charset for Oracle US7ASCII databases (e.g., ms949, euc-kr)'
    ),
});

export type DbConnectInput = z.infer<typeof dbConnectInputSchema>;

/**
 * db_connect 도구의 출력 인터페이스
 */
export interface DbConnectOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  details?: {
    type: string;
    host: string;
    port: number;
    database: string;
  };
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
 * 제공된 자격 증명으로 DB 연결을 등록하고 테스트합니다.
 *
 * @param input - 연결 자격 증명
 * @param connManager - ConnectionManager 인스턴스
 * @returns 연결 테스트 결과 및 connectionId
 */
export async function dbConnect(
  input: DbConnectInput,
  connManager: ConnectionManager
): Promise<DbConnectOutput> {
  const port = input.port || getDefaultPort(input.type);

  try {
    // Oracle: Thick 모드 초기화 (한글 캐릭터셋 변환용)
    // if (input.type === 'oracle' && input.oracleDataCharset) {
    //   await initializeOracleDriver({
    //     oracleDataCharset: input.oracleDataCharset,
    //   });
    // }

    // ConnectionManager에 등록 (Knex 풀 생성)
    const { connectionId, isNew } = connManager.register({
      type: input.type,
      host: input.host,
      port,
      user: input.user,
      password: input.password,
      database: input.database,
      serviceName: input.serviceName,
      oracleDataCharset: input.oracleDataCharset,
    });

    // 연결 테스트
    const entry = connManager.getEntry(connectionId)!;
    const testQuery =
      input.type === 'oracle' ? 'SELECT 1 FROM DUAL' : 'SELECT 1';
    await entry.knex.raw(testQuery);

    return {
      success: true,
      message: isNew
        ? 'Database connection registered successfully. Use connectionId in subsequent calls.'
        : 'Reconnected to existing connection.',
      connectionId,
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
  }
}
