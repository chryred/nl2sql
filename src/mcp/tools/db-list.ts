/**
 * DB 연결 목록 도구
 *
 * @description
 * 등록된 활성 데이터베이스 연결 목록을 반환합니다.
 * 비밀번호는 포함되지 않습니다.
 *
 * @module mcp/tools/db-list
 */

import { z } from 'zod';
import type { ConnectionManager } from '../../database/connection-manager.js';

/**
 * db_list_connections 도구의 입력 스키마
 */
export const dbListInputSchema = z.object({});

export type DbListInput = z.infer<typeof dbListInputSchema>;

/**
 * db_list_connections 도구의 출력 인터페이스
 */
export interface DbListOutput {
  success: boolean;
  count: number;
  connections: Array<{
    connectionId: string;
    type: string;
    host: string;
    port: number;
    database: string;
    user: string;
    createdAt: string;
    lastUsedAt: string;
    hasCachedMetadata: boolean;
  }>;
}

/**
 * 활성 연결 목록을 반환합니다.
 *
 * @param connManager - ConnectionManager 인스턴스
 * @returns 연결 목록
 */
export function dbListConnections(
  connManager: ConnectionManager
): DbListOutput {
  const connections = connManager.listConnections();
  return {
    success: true,
    count: connections.length,
    connections,
  };
}
