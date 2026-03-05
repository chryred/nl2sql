/**
 * NL2SQL 쿼리 도구
 *
 * @description
 * 자연어를 SQL로 변환하고 선택적으로 실행합니다.
 * ConnectionManager를 통해 다중 연결을 지원합니다.
 *
 * @module mcp/tools/nl2sql-query
 */

import { z } from 'zod';
import {
  getConfig,
  validateConfig,
  type Config,
} from '../../config/index.js';
import {
  createConnection,
  closeConnection,
} from '../../database/connection.js';
import { NL2SQLEngine } from '../../core/nl2sql-engine.js';
import { validateNaturalLanguageInput } from '../../utils/input-validator.js';
import { validateSQL } from '../../ai/response-parser.js';
import { maskSensitiveInfo } from '../../errors/index.js';
import { buildConfigFromEntry } from '../utils/config-helper.js';
import type { ConnectionManager } from '../../database/connection-manager.js';
import { saveQueryHistory } from './query-history.js';


/**
 * nl2sql_query 도구의 입력 스키마
 */
export const nl2sqlQueryInputSchema = z.object({
  query: z.string().min(1).describe('Natural language query to convert to SQL'),
  execute: z
    .boolean()
    .default(false)
    .describe('Whether to execute the generated SQL (default: false)'),
  format: z
    .enum(['json', 'text'])
    .default('json')
    .describe('Output format (default: json)'),
  connectionId: z
    .string()
    .optional()
    .describe(
      'Connection ID from db_connect (optional, uses default if omitted)'
    ),
  sql: z
    .string()
    .optional()
    .describe(
      'Pre-generated SQL from a previous call. When provided, skips AI generation and executes directly (requires execute: true to run).'
    ),
});

export type Nl2sqlQueryInput = z.infer<typeof nl2sqlQueryInputSchema>;

/**
 * nl2sql_query 도구의 출력 인터페이스
 */
export interface Nl2sqlQueryOutput {
  success: boolean;
  sql?: string;
  executed?: boolean;
  results?: unknown[];
  rowCount?: number;
  error?: string;
  /** 실행 결과가 부정확할 때 피드백 방법 안내 */
  feedbackHint?: string;
}

/**
 * 자연어를 SQL로 변환하고 선택적으로 실행합니다.
 *
 * @param input - 자연어 쿼리 및 옵션
 * @param connManager - ConnectionManager 인스턴스
 * @returns 변환 결과
 */
export async function nl2sqlQuery(
  input: Nl2sqlQueryInput,
  connManager: ConnectionManager
): Promise<Nl2sqlQueryOutput> {
  // 입력 검증
  const validation = validateNaturalLanguageInput(input.query);
  if (!validation.valid) {
    return {
      success: false,
      error: `Input validation failed: ${validation.error}`,
    };
  }

  // ConnectionManager에서 연결 해석
  const entry = connManager.resolve(input.connectionId);

  if (entry) {
    // ConnectionManager 경로
    try {
      const config = buildConfigFromEntry(entry);
      const [metadataCache, schemaCache] = await Promise.all([
        connManager.getOrInitCache(entry.connectionId),
        connManager.getOrInitSchemaCache(entry.connectionId, config),
      ]);
      const engine = new NL2SQLEngine(entry.knex, config, { metadataCache, schemaCache });

      let sql: string;
      let executionResult: unknown[] | undefined;

      if (input.sql) {
        // 이미 생성된 SQL이 있으면 AI 호출 스킵
        const sqlValidation = validateSQL(input.sql);
        if (!sqlValidation.valid) {
          return {
            success: false,
            error: `SQL validation failed: ${sqlValidation.error}`,
          };
        }
        sql = input.sql;  // output.sql은 원본 유지

        if (input.execute) {
          const shouldWrap =
            entry.params.type === 'oracle' &&
            !!entry.params.oracleDataCharset;

          const sqlToExecute = shouldWrap
            ? await engine.wrapOracleKoreanColumns(sql)
            : sql;

          executionResult = await engine.executeSQL(sqlToExecute);
        }
      } else {
        // 기존 flow: 자연어 → AI → SQL → 선택적 실행
        const result = await engine.process(validation.sanitized, input.execute);
        sql = result.sql;
        executionResult = result.executionResult;
      }

      const output: Nl2sqlQueryOutput = {
        success: true,
        sql,
        executed: input.execute,
      };

      if (input.execute && executionResult) {
        output.results = executionResult;
        output.rowCount = executionResult.length;
        output.feedbackHint =
          '결과가 정확하지 않으면 query_feedback 도구로 피드백을 남겨 메타데이터를 개선할 수 있습니다.';
      }

      // 쿼리 이력 자동 저장 (fire-and-forget, 실패해도 메인 흐름 영향 없음)
      saveQueryHistory(
        entry.knex,
        entry.params.type,
        validation.sanitized,
        sql,
        entry.connectionId,
        input.execute ?? false,
        entry.params.oracleDataCharset
      ).catch(() => {});

      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Query error: ${maskSensitiveInfo(message)}`,
      };
    }
  }

  // Legacy 폴백: 환경변수 기반
  return nl2sqlQueryLegacy(input);
}

/**
 * 환경변수 기반 레거시 경로 (하위 호환).
 */
async function nl2sqlQueryLegacy(
  input: Nl2sqlQueryInput
): Promise<Nl2sqlQueryOutput> {
  let config: Config;

  try {
    config = getConfig();
    validateConfig(config);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown configuration error';
    return {
      success: false,
      error: `Configuration error: ${maskSensitiveInfo(message)}. Use db_connect to establish a connection first.`,
    };
  }

  try {
    const knex = createConnection(config);
    const engine = new NL2SQLEngine(knex, config);

    let sql: string;
    let executionResult: unknown[] | undefined;

    if (input.sql) {
      const sqlValidation = validateSQL(input.sql);
      if (!sqlValidation.valid) {
        return {
          success: false,
          error: `SQL validation failed: ${sqlValidation.error}`,
        };
      }
      sql = input.sql;  // output.sql은 원본 유지

      if (input.execute) {
        const shouldWrap =
          config.database.type === 'oracle' &&
          !!config.database.oracleDataCharset;

        const sqlToExecute = shouldWrap
          ? await engine.wrapOracleKoreanColumns(sql)
          : sql;

        executionResult = await engine.executeSQL(sqlToExecute);
      }
    } else {
      // 기존 flow: 자연어 → AI → SQL → 선택적 실행
      const result = await engine.process(
        validateNaturalLanguageInput(input.query).sanitized,
        input.execute
      );
      sql = result.sql;
      executionResult = result.executionResult;
    }

    const output: Nl2sqlQueryOutput = {
      success: true,
      sql,
      executed: input.execute,
    };

    if (input.execute && executionResult) {
      output.results = executionResult;
      output.rowCount = executionResult.length;
    }

    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Query error: ${maskSensitiveInfo(message)}`,
    };
  } finally {
    await closeConnection();
  }
}

/**
 * 결과를 텍스트 형식으로 포맷합니다.
 *
 * @param output - 쿼리 출력
 * @returns 텍스트 형식 결과
 */
export function formatAsText(output: Nl2sqlQueryOutput): string {
  if (!output.success) {
    return `Error: ${output.error}`;
  }

  const lines: string[] = [];
  lines.push(`SQL: ${output.sql}`);

  if (output.executed) {
    lines.push(`Executed: Yes`);
    lines.push(`Row Count: ${output.rowCount}`);

    if (output.results && output.results.length > 0) {
      lines.push('');
      lines.push('Results:');
      // 최대 10개 행만 텍스트로 표시
      const displayRows = output.results.slice(0, 10);
      for (const row of displayRows) {
        lines.push(JSON.stringify(row));
      }
      if (output.results.length > 10) {
        lines.push(`... and ${output.results.length - 10} more rows`);
      }
    }
  } else {
    lines.push(`Executed: No (dry run)`);
  }

  return lines.join('\n');
}
