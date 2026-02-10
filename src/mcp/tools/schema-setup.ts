/**
 * 메타데이터 스키마 자동 생성 MCP 도구
 *
 * @description
 * 연결된 데이터베이스에 NL2SQL 메타데이터 테이블을 자동 생성합니다.
 *
 * @module mcp/tools/schema-setup
 */

import { z } from 'zod';
import type { ConnectionManager } from '../../database/connection-manager.js';
import { setupMetadataSchema } from '../../database/metadata/index.js';
import type { SchemaSetupResult } from '../../database/metadata/index.js';
import { maskSensitiveInfo } from '../../errors/index.js';

/**
 * schema_setup 도구의 입력 스키마
 */
export const schemaSetupInputSchema = z.object({
  connectionId: z
    .string()
    .optional()
    .describe(
      'Connection ID to setup schema for (optional, uses default if omitted)'
    ),
  confirm: z
    .boolean()
    .describe(
      'Must be true to proceed. IMPORTANT: Ask the user for explicit confirmation before setting this to true.'
    ),
});

export type SchemaSetupInput = z.infer<typeof schemaSetupInputSchema>;

/**
 * schema_setup 도구의 출력 인터페이스
 */
export interface SchemaSetupOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  result?: SchemaSetupResult;
  error?: string;
}

/**
 * 메타데이터 스키마를 자동 생성합니다.
 *
 * @param input - 입력 파라미터
 * @param connManager - ConnectionManager 인스턴스
 * @returns 스키마 생성 결과
 */
export async function schemaSetup(
  input: SchemaSetupInput,
  connManager: ConnectionManager
): Promise<SchemaSetupOutput> {
  if (!input.confirm) {
    return {
      success: false,
      message:
        'User confirmation required. Please ask the user to confirm before creating metadata tables. Set confirm=true to proceed.',
    };
  }

  const entry = connManager.resolve(input.connectionId);

  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
    };
  }

  try {
    const result = await setupMetadataSchema(entry.knex, entry.params.type);

    // 성공 시 캐시 무효화 → 다음 쿼리에서 새로 로드
    if (result.success) {
      connManager.invalidateCache(entry.connectionId);
    }

    return {
      success: result.success,
      message: result.summary,
      connectionId: entry.connectionId,
      result,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to setup metadata schema',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}
