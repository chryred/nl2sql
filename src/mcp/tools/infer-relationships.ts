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
import type {
  InferredRelationship,
  InferenceResult,
} from '../../database/metadata/relationship-inference.js';
import { maskSensitiveInfo } from '../../errors/index.js';

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
      'Inference types to run (default: both). naming_convention=MEDIUM confidence, column_match=LOW confidence'
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
  result?: InferenceResult;
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
    // 메타데이터 캐시 초기화 (네이밍 컨벤션 + 기존 관계 로드)
    const cache = await connManager.getOrInitCache(entry.connectionId);
    const namingConventions = cache?.namingConventions ?? [];
    const existingRelationships = cache?.relationships ?? [];

    // 추론 실행
    const candidates = await inferRelationships(
      entry.knex,
      entry.params.type,
      namingConventions,
      existingRelationships,
      {
        schema: input.schema,
        types: input.types,
      }
    );

    if (input.mode === 'preview') {
      return {
        success: true,
        message: `Found ${candidates.length} relationship candidates`,
        connectionId: entry.connectionId,
        result: {
          candidates,
        },
      };
    }

    // apply 모드
    if (candidates.length === 0) {
      return {
        success: true,
        message: 'No new relationships to apply',
        connectionId: entry.connectionId,
        result: {
          candidates: [],
          applied: 0,
          skipped: 0,
        },
      };
    }

    const { applied, skipped } = await applyInferredRelationships(
      entry.knex,
      entry.params.type,
      candidates,
      entry.params.oracleDataCharset
    );

    // 캐시 무효화 (새 관계가 추가되었으므로)
    if (applied > 0) {
      connManager.invalidateCache(entry.connectionId);
    }

    return {
      success: true,
      message: `Applied ${applied} relationships, skipped ${skipped}`,
      connectionId: entry.connectionId,
      result: {
        candidates,
        applied,
        skipped,
      },
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

/**
 * 추론 결과를 텍스트로 포맷합니다.
 */
export function formatInferenceResult(
  result: InferenceResult
): string {
  const lines: string[] = [];

  if (result.candidates.length === 0) {
    return 'No relationship candidates found.';
  }

  // 그룹별 분류
  const ncCandidates: InferredRelationship[] = [];
  const cmCandidates: InferredRelationship[] = [];

  for (const c of result.candidates) {
    if (c.inferenceType === 'naming_convention') {
      ncCandidates.push(c);
    } else {
      cmCandidates.push(c);
    }
  }

  if (ncCandidates.length > 0) {
    lines.push(
      `\n## Naming Convention (MEDIUM confidence, auto-active): ${ncCandidates.length} candidates`
    );
    for (const c of ncCandidates) {
      lines.push(
        `  ${c.sourceSchema}.${c.sourceTable}.${c.sourceColumn} → ${c.targetSchema}.${c.targetTable}.${c.targetColumn} [${c.matchedPattern}]`
      );
    }
  }

  if (cmCandidates.length > 0) {
    lines.push(
      `\n## Column Match (LOW confidence, manual review): ${cmCandidates.length} candidates`
    );
    for (const c of cmCandidates) {
      lines.push(
        `  ${c.sourceSchema}.${c.sourceTable}.${c.sourceColumn} → ${c.targetSchema}.${c.targetTable}.${c.targetColumn}`
      );
    }
  }

  if (result.applied !== undefined) {
    lines.push(`\nApplied: ${result.applied}, Skipped: ${result.skipped}`);
  }

  return lines.join('\n');
}
