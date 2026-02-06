/**
 * NL2SQL 쿼리 도구
 *
 * @description
 * 자연어를 SQL로 변환하고 선택적으로 실행합니다.
 * 핵심 NL2SQL 기능을 MCP 도구로 노출합니다.
 *
 * @module mcp/tools/nl2sql-query
 */

import { z } from 'zod';
import { getConfig, validateConfig, type Config } from '../../config/index.js';
import {
  createConnection,
  closeConnection,
} from '../../database/connection.js';
import { NL2SQLEngine } from '../../core/nl2sql-engine.js';
import { validateNaturalLanguageInput } from '../../utils/input-validator.js';
import { maskSensitiveInfo } from '../../errors/index.js';

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
}

/**
 * 자연어를 SQL로 변환하고 선택적으로 실행합니다.
 *
 * @param input - 자연어 쿼리 및 옵션
 * @returns 변환 결과
 */
export async function nl2sqlQuery(
  input: Nl2sqlQueryInput
): Promise<Nl2sqlQueryOutput> {
  // 입력 검증
  const validation = validateNaturalLanguageInput(input.query);
  if (!validation.valid) {
    return {
      success: false,
      error: `Input validation failed: ${validation.error}`,
    };
  }

  let config: Config;

  try {
    config = getConfig();
    validateConfig(config);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown configuration error';
    return {
      success: false,
      error: `Configuration error: ${maskSensitiveInfo(message)}`,
    };
  }

  try {
    const knex = createConnection(config);
    const engine = new NL2SQLEngine(knex, config);

    const result = await engine.process(validation.sanitized, input.execute);

    const output: Nl2sqlQueryOutput = {
      success: true,
      sql: result.sql,
      executed: input.execute,
    };

    if (input.execute && result.executionResult) {
      output.results = result.executionResult;
      output.rowCount = result.executionResult.length;
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
