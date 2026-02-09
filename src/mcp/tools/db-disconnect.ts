/**
 * DB 연결 해제 도구
 *
 * @description
 * 등록된 데이터베이스 연결을 해제하고 리소스를 정리합니다.
 *
 * @module mcp/tools/db-disconnect
 */

import { z } from 'zod';
import type { ConnectionManager } from '../../database/connection-manager.js';

/**
 * db_disconnect 도구의 입력 스키마
 */
export const dbDisconnectInputSchema = z.object({
  connectionId: z
    .string()
    .min(1)
    .describe('Connection ID to disconnect (from db_connect)'),
});

export type DbDisconnectInput = z.infer<typeof dbDisconnectInputSchema>;

/**
 * db_disconnect 도구의 출력 인터페이스
 */
export interface DbDisconnectOutput {
  success: boolean;
  message: string;
}

/**
 * 등록된 연결을 해제합니다.
 *
 * @param input - 연결 식별자
 * @param connManager - ConnectionManager 인스턴스
 * @returns 해제 결과
 */
export async function dbDisconnect(
  input: DbDisconnectInput,
  connManager: ConnectionManager
): Promise<DbDisconnectOutput> {
  try {
    const removed = await connManager.disconnect(input.connectionId);
    if (removed) {
      return {
        success: true,
        message: `Connection ${input.connectionId} disconnected successfully.`,
      };
    }
    return {
      success: false,
      message: `Connection ${input.connectionId} not found.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Disconnect failed: ${message}`,
    };
  }
}
