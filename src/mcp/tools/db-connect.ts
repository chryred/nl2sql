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

/**
 * db_connect 도구의 입력 스키마
 */
export const dbConnectInputSchema = z.object({
  systemName: z.string().min(1).describe('[Ask this FIRST] System name to identify this connection (e.g., 고객경험, 주문관리)'),
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
    systemName: string;
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

  // ConnectionManager에 등록 (기존 연결이면 생존 테스트 포함)
  const { connectionId, isNew } = await connManager.register({
    systemName: input.systemName,
    type: input.type,
    host: input.host,
    port,
    user: input.user,
    password: input.password,
    database: input.database,
    serviceName: input.serviceName,
    oracleDataCharset: input.oracleDataCharset,
  });

  // 기존 연결은 register() 내부에서 이미 검증됨
  if (!isNew) {
    return {
      success: true,
      message: 'Existing connection verified and reused.',
      connectionId,
      details: {
        systemName: input.systemName,
        type: input.type,
        host: input.host,
        port,
        database: input.database,
      },
    };
  }

  // 신규 연결 테스트
  try {
    const entry = connManager.getEntry(connectionId)!;
    const alive = await connManager.testConnection(entry.knex, input.type);

    if(alive) {
      return {
        success: true,
        message:
          'Database connection registered successfully. Use connectionId in subsequent calls.',
        connectionId,
        details: {
          systemName: input.systemName,
          type: input.type,
          host: input.host,
          port,
          database: input.database,
        },
      };
    } else {
      throw new Error('Database connection failed!!');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await connManager.disconnect(connectionId);

    return {
      success: false,
      message: `Connection failed: ${maskSensitiveInfo(message)}`,
      details: {
        systemName: input.systemName,
        type: input.type,
        host: input.host,
        port,
        database: input.database,
      },
    };
  }
}
