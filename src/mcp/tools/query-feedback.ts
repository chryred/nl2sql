/**
 * MCP Tool: query_feedback
 *
 * 쿼리 피드백을 통한 자동 메타데이터 개선 시스템.
 * preview 모드: AI 분석 결과 및 개선 제안 목록 반환
 * apply  모드: 제안된 메타데이터를 실제 DB에 적용
 *
 * @module mcp/tools/query-feedback
 */
import { z } from 'zod';
import type { ConnectionManager } from '../../database/connection-manager.js';
import type { ConnectionEntry } from '../../database/connection-manager.js';
import { maskSensitiveInfo } from '../../errors/index.js';
import { buildConfigFromEntry } from '../utils/config-helper.js';
import { createAIClient } from '../../ai/client-factory.js';
import {
  analyzeFeedback,
  type MetadataSuggestion,
} from '../../database/feedback-analyzer.js';
import { applyGlossaryTerms } from '../../database/glossary-generator.js';
import { applyInferredRelationships } from '../../database/metadata/relationship-inference.js';
import type { InferredRelationship } from '../../database/metadata/relationship-inference.js';

// ============================================================================
// Input Schema
// ============================================================================

export const queryFeedbackInputSchema = z.object({
  connectionId: z.string().optional(),
  mode: z.enum(['preview', 'apply']),
  originalQuery: z.string().min(1).describe('Original natural language query'),
  generatedSql: z.string().min(1).describe('SQL that was generated'),
  correctedSql: z.string().optional().describe('User-corrected SQL (Option A)'),
  rating: z
    .enum(['good', 'bad', 'partial'])
    .optional()
    .describe('User rating of SQL quality'),
  feedback: z
    .string()
    .optional()
    .describe('Natural language feedback about what was wrong'),
});

export type QueryFeedbackInput = z.infer<typeof queryFeedbackInputSchema>;

// ============================================================================
// Output Interface
// ============================================================================

export interface QueryFeedbackOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  mode: 'preview' | 'apply';
  analysis?: string;
  suggestions?: MetadataSuggestion[];
  applied?: number;
  error?: string;
}

// ============================================================================
// Apply helpers
// ============================================================================

/**
 * 단일 제안을 DB에 적용합니다.
 *
 * @param suggestion - 메타데이터 개선 제안
 * @param entry - 연결 항목
 * @returns 적용 성공 여부
 */
async function applySuggestion(
  suggestion: MetadataSuggestion,
  entry: ConnectionEntry
): Promise<boolean> {
  const dbType = entry.params.type;
  const charset = entry.params.oracleDataCharset;

  try {
    switch (suggestion.type) {
      case 'glossary': {
        const data = suggestion.data as {
          termCode?: string;
          term?: string;
          category?: string;
          sqlCondition?: string;
          definition?: string;
          aliases?: string[];
        };
        if (!data.termCode || !data.term || !data.sqlCondition) return false;

        const candidates = [
          {
            termCode: String(data.termCode),
            term: String(data.term),
            category: (data.category ?? 'BUSINESS') as 'BUSINESS',
            sqlCondition: String(data.sqlCondition),
            definition: data.definition ? String(data.definition) : undefined,
            aliases: Array.isArray(data.aliases) ? (data.aliases as string[]) : undefined,
          },
        ];
        const applied = await applyGlossaryTerms(entry.knex, dbType, candidates, charset);
        return applied > 0;
      }

      case 'relationship': {
        const data = suggestion.data as {
          sourceSchema?: string;
          sourceTable?: string;
          sourceColumn?: string;
          targetSchema?: string;
          targetTable?: string;
          targetColumn?: string;
          relationshipType?: string;
          joinHint?: string;
        };
        if (
          !data.sourceSchema || !data.sourceTable || !data.sourceColumn ||
          !data.targetSchema || !data.targetTable || !data.targetColumn
        ) return false;

        const candidate: InferredRelationship = {
          sourceSchema: String(data.sourceSchema),
          sourceTable: String(data.sourceTable),
          sourceColumn: String(data.sourceColumn),
          targetSchema: String(data.targetSchema),
          targetTable: String(data.targetTable),
          targetColumn: String(data.targetColumn),
          relationshipType: (data.relationshipType as 'MANY_TO_ONE') ?? 'MANY_TO_ONE',
          confidenceLevel: 'HIGH',
          joinHint: (data.joinHint as 'LEFT') ?? 'LEFT',
          inferenceType: 'column_match',
          description: '',
        };
        const { applied } = await applyInferredRelationships(entry.knex, dbType, [candidate], charset);
        return applied > 0;
      }

      default:
        // code_table, query_pattern, naming_convention 타입은
        // 복잡한 검증이 필요하므로 사용자가 전용 도구로 직접 적용하도록 안내
        return false;
    }
  } catch {
    return false;
  }
}

// ============================================================================
// Main handler
// ============================================================================

/**
 * 쿼리 피드백을 처리합니다.
 *
 * @param input - 피드백 입력
 * @param connManager - ConnectionManager 인스턴스
 * @returns 피드백 처리 결과
 */
export async function queryFeedback(
  input: QueryFeedbackInput,
  connManager: ConnectionManager
): Promise<QueryFeedbackOutput> {
  const entry = connManager.resolve(input.connectionId);
  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
      mode: input.mode,
    };
  }

  try {
    const cache = await connManager.getOrInitCache(entry.connectionId);
    if (!cache) {
      return {
        success: false,
        message: 'Metadata cache not available. Try cache_refresh first.',
        connectionId: entry.connectionId,
        mode: input.mode,
      };
    }

    const config = buildConfigFromEntry(entry);
    const aiClient = createAIClient(config);

    // AI 분석
    const analysisResult = await analyzeFeedback(
      aiClient,
      {
        originalQuery: input.originalQuery,
        generatedSql: input.generatedSql,
        correctedSql: input.correctedSql,
        rating: input.rating,
        feedback: input.feedback,
      },
      cache,
      entry.params.type
    );

    if (input.mode === 'preview') {
      return {
        success: true,
        message: `Analysis complete: ${analysisResult.suggestions.length} suggestion(s)`,
        connectionId: entry.connectionId,
        mode: 'preview',
        analysis: analysisResult.analysis,
        suggestions: analysisResult.suggestions,
      };
    }

    // apply: 적용 가능한 제안 실행
    let applied = 0;
    for (const suggestion of analysisResult.suggestions) {
      const ok = await applySuggestion(suggestion, entry);
      if (ok) applied++;
    }

    // 캐시 무효화 (변경이 있었을 경우에만)
    if (applied > 0) {
      connManager.invalidateCache(entry.connectionId);
    }

    const notApplied = analysisResult.suggestions.length - applied;
    const noteMsg =
      notApplied > 0
        ? ` (${notApplied} suggestion(s) require manual application via dedicated tools: code_table_manage, query_pattern_add, naming_convention_manage)`
        : '';

    return {
      success: true,
      message: `Applied ${applied}/${analysisResult.suggestions.length} suggestions${noteMsg}`,
      connectionId: entry.connectionId,
      mode: 'apply',
      analysis: analysisResult.analysis,
      suggestions: analysisResult.suggestions,
      applied,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to process feedback',
      connectionId: entry.connectionId,
      mode: input.mode,
      error: maskSensitiveInfo(msg),
    };
  }
}
