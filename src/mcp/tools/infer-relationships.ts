/**
 * 관계 추론 MCP 도구
 *
 * @description
 * 네이밍 컨벤션 및 동일 컬럼명 기반으로 FK 관계를 자동 추론합니다.
 * preview 모드로 미리보기 후, apply 모드로 선택적 적용이 가능합니다.
 *
 * @module mcp/tools/infer-relationships
 */

import { z } from 'zod';
import type { ConnectionManager } from '../../database/connection-manager.js';
import {
  inferRelationships,
  applyInferredRelationships,
} from '../../database/metadata/relationship-inference.js';
import { maskSensitiveInfo } from '../../errors/index.js';
import { buildConfigFromEntry } from '../utils/config-helper.js';
import { createAIClient } from '../../ai/client-factory.js';

/**
 * infer_relationships 도구의 입력 스키마
 */
export const inferRelationshipsInputSchema = z.object({
  connectionId: z
    .string()
    .optional()
    .describe(
      'Connection ID (optional, uses default if omitted)'
    ),
  mode: z
    .enum(['preview', 'apply'])
    .describe(
      'preview: show candidates without inserting, apply: insert into table_relationships'
    ),
  types: z
    .array(z.enum(['naming_convention', 'column_match']))
    .optional()
    .describe(
      'Inference types to run (default: both). naming_convention=pattern-based MEDIUM confidence, column_match=LLM-based inference (auto-active)'
    ),
  schema: z
    .string()
    .optional()
    .describe('Filter to specific schema (optional, all user schemas if omitted)'),
});

export type InferRelationshipsInput = z.infer<
  typeof inferRelationshipsInputSchema
>;

/**
 * infer_relationships 도구의 출력 인터페이스
 */
export interface InferRelationshipsOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  error?: string;
}

/**
 * 관계를 추론하고 미리보기 또는 적용합니다.
 *
 * @param input - 입력 파라미터
 * @param connManager - ConnectionManager 인스턴스
 * @returns 추론 결과
 */
export async function inferRelationshipsTool(
  input: InferRelationshipsInput,
  connManager: ConnectionManager
): Promise<InferRelationshipsOutput> {
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
    // 메타데이터 캐시 + AI provider + 스키마 준비
    const config = buildConfigFromEntry(entry);
    const [cache, schemaTables] = await Promise.all([
      connManager.getOrInitCache(entry.connectionId),
      connManager.getOrInitSchemaCache(entry.connectionId, config).then((sc) => sc?.tables ?? []),
    ]);

    const namingConventions     = cache?.namingConventions     ?? [];
    const existingRelationships = cache?.relationships         ?? [];
    const metadata              = cache ?? undefined;

    // AI provider (column_match 타입에 필요)
    let aiProvider;
    try {
      aiProvider = createAIClient(config);
    } catch {
      aiProvider = undefined; // AI 설정 없으면 LLM 추론 skip
    }

    // 추론 실행
    const candidates = await inferRelationships(
      entry.knex,
      entry.params.type,
      namingConventions,
      existingRelationships,
      {
        schema: input.schema,
        types: input.types,
        aiProvider,
        schemaTables,
        metadata,
      }
    );

    // 타입별 카운트
    const ncCount  = candidates.filter((c) => c.inferenceType === 'naming_convention').length;
    const llmCount = candidates.filter((c) => c.inferenceType === 'column_match').length;

    if (input.mode === 'preview') {
      return {
        success: true,
        message: `Found ${candidates.length} candidates (naming_convention: ${ncCount}, llm: ${llmCount})`,
        connectionId: entry.connectionId,
      };
    }

    // apply 모드
    if (candidates.length === 0) {
      return {
        success: true,
        message: 'No new relationships to apply',
        connectionId: entry.connectionId,
      };
    }

    const { applied, skipped } = await applyInferredRelationships(
      entry.knex,
      entry.params.type,
      candidates,
      entry.params.oracleDataCharset
    );

    if (applied > 0) {
      connManager.invalidateCache(entry.connectionId);
    }

    return {
      success: true,
      message: `Applied ${applied}, skipped ${skipped}`,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to infer relationships',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}
