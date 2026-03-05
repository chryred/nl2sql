/**
 * 쿼리 피드백 분석 모듈 (AI 기반)
 *
 * @description
 * 원본 자연어 쿼리, 생성된 SQL, 수정된 SQL 또는 자연어 피드백을 분석하여
 * 메타데이터 개선 제안을 생성합니다.
 *
 * @module database/feedback-analyzer
 */
import type { AIProvider } from '../ai/providers/openai.js';
import type { MetadataCache } from './metadata/types.js';
import type { DatabaseType } from './types.js';
import { logger } from '../logger/index.js';

// ============================================================================
// 타입 정의
// ============================================================================

/**
 * 피드백 분석 입력
 */
export interface FeedbackAnalysisInput {
  originalQuery: string;
  generatedSql: string;
  correctedSql?: string;
  rating?: 'good' | 'bad' | 'partial';
  feedback?: string;
}

/**
 * 메타데이터 개선 제안
 */
export interface MetadataSuggestion {
  type: 'glossary' | 'relationship' | 'code_table' | 'query_pattern' | 'naming_convention';
  action: 'add' | 'update' | 'deactivate';
  data: Record<string, unknown>;
  reason: string;
}

/**
 * 피드백 분석 결과
 */
export interface FeedbackAnalysisResult {
  analysis: string;
  suggestions: MetadataSuggestion[];
}

// ============================================================================
// 시스템 프롬프트
// ============================================================================

const FEEDBACK_SYSTEM_PROMPT = `You are a senior NL2SQL metadata expert.
Analyze the difference between a generated SQL and a corrected SQL (or user feedback) to identify what metadata improvements would prevent this type of error in the future.

Focus on:
1. Missing or incorrect glossary terms (Korean business terms that should map to specific SQL conditions)
2. Missing FK relationships that should be JOIN hints
3. Missing code table mappings (columns that should be looked up in code tables)
4. Query patterns that could generalize this type of query
5. Naming convention patterns that could infer relationships automatically

Return ONLY a valid JSON object with this structure:
{
  "analysis": "Korean explanation of what went wrong and why",
  "suggestions": [
    {
      "type": "glossary|relationship|code_table|query_pattern|naming_convention",
      "action": "add|update|deactivate",
      "data": { ... metadata fields specific to the type ... },
      "reason": "Korean explanation of why this change would help"
    }
  ]
}

For glossary type data fields: { termCode, term, category, sqlCondition, definition, aliases[] }
For relationship type data fields: { sourceSchema, sourceTable, sourceColumn, targetSchema, targetTable, targetColumn, relationshipType, joinHint }
For code_table type data fields: { codeTableName, targetSchema, targetTable, targetColumn }
For query_pattern type data fields: { patternName, category, sqlTemplate, description, keywords[] }

If no improvements are needed (rating=good), return { "analysis": "SQL generation was correct", "suggestions": [] }`;

// ============================================================================
// 프롬프트 빌더
// ============================================================================

/**
 * 피드백 분석 프롬프트를 빌드합니다.
 *
 * @param input - 피드백 입력 데이터
 * @param cache - 현재 메타데이터 캐시
 * @param dbType - DB 타입
 * @returns 사용자 프롬프트 문자열
 */
export function buildFeedbackPrompt(
  input: FeedbackAnalysisInput,
  cache: MetadataCache,
  dbType: DatabaseType
): string {
  const lines: string[] = [];

  lines.push(`## Database Type: ${dbType}`);
  lines.push('');
  lines.push(`## Original Natural Language Query:`);
  lines.push(input.originalQuery);
  lines.push('');
  lines.push(`## Generated SQL:`);
  lines.push('```sql');
  lines.push(input.generatedSql);
  lines.push('```');
  lines.push('');

  if (input.correctedSql) {
    lines.push(`## Corrected SQL (user's intended query):`);
    lines.push('```sql');
    lines.push(input.correctedSql);
    lines.push('```');
    lines.push('');
  }

  if (input.rating) {
    lines.push(`## User Rating: ${input.rating}`);
    lines.push('');
  }

  if (input.feedback) {
    lines.push(`## User Feedback (Korean):`);
    lines.push(input.feedback);
    lines.push('');
  }

  // 현재 메타데이터 컨텍스트 (최소한의 정보)
  if (cache.glossaryTerms.length > 0) {
    lines.push('## Current Glossary Terms (first 10):');
    for (const t of cache.glossaryTerms.slice(0, 10)) {
      lines.push(`  - ${t.term}: ${t.sqlCondition}`);
    }
    lines.push('');
  }

  if (cache.relationships.length > 0) {
    lines.push('## Current FK Relationships (first 10):');
    for (const r of cache.relationships.slice(0, 10)) {
      lines.push(`  - ${r.sourceTable}.${r.sourceColumn} → ${r.targetTable}.${r.targetColumn}`);
    }
    lines.push('');
  }

  lines.push('Analyze the gap between the generated SQL and the expected behavior, then suggest specific metadata improvements.');

  return lines.join('\n');
}

// ============================================================================
// 응답 파서
// ============================================================================

/**
 * AI 응답에서 피드백 분석 결과를 파싱합니다.
 *
 * @param response - AI 응답 텍스트
 * @returns 파싱된 분석 결과
 */
export function parseFeedbackResponse(response: string): FeedbackAnalysisResult {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { analysis: 'Could not parse AI response', suggestions: [] };
    }
    const parsed = JSON.parse(jsonMatch[0]) as Partial<FeedbackAnalysisResult>;
    return {
      analysis: typeof parsed.analysis === 'string' ? parsed.analysis : '',
      suggestions: Array.isArray(parsed.suggestions)
        ? (parsed.suggestions as MetadataSuggestion[]).filter(
            (s) =>
              typeof s === 'object' &&
              s !== null &&
              typeof s.type === 'string' &&
              typeof s.action === 'string' &&
              typeof s.data === 'object' &&
              typeof s.reason === 'string'
          )
        : [],
    };
  } catch {
    logger.warn('Failed to parse feedback response', { response: response.slice(0, 200) });
    return { analysis: 'Parse error', suggestions: [] };
  }
}

// ============================================================================
// 메인 분석 함수
// ============================================================================

/**
 * 피드백을 AI로 분석하여 메타데이터 개선 제안을 반환합니다.
 *
 * @param aiClient - AI 클라이언트
 * @param input - 피드백 입력
 * @param cache - 메타데이터 캐시
 * @param dbType - DB 타입
 * @returns 분석 결과 및 개선 제안 목록
 */
export async function analyzeFeedback(
  aiClient: AIProvider,
  input: FeedbackAnalysisInput,
  cache: MetadataCache,
  dbType: DatabaseType
): Promise<FeedbackAnalysisResult> {
  // good 평가는 분석 불필요
  if (input.rating === 'good' && !input.correctedSql && !input.feedback) {
    return { analysis: 'SQL generation was correct. No improvements needed.', suggestions: [] };
  }

  const userPrompt = buildFeedbackPrompt(input, cache, dbType);
  try {
    const response = await aiClient.generateComment(FEEDBACK_SYSTEM_PROMPT, userPrompt);
    return parseFeedbackResponse(response);
  } catch (err) {
    logger.warn('Feedback analysis failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { analysis: 'AI analysis failed', suggestions: [] };
  }
}
