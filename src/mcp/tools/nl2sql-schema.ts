/**
 * 스키마 조회 도구
 *
 * @description
 * 데이터베이스 스키마 정보를 조회하여 반환합니다.
 * JSON, 프롬프트, 요약 형식 중 선택 가능합니다.
 *
 * @module mcp/tools/nl2sql-schema
 */

import { z } from 'zod';
import { getConfig, validateConfig, type Config } from '../../config/index.js';
import { createConnection, closeConnection } from '../../database/connection.js';
import { extractSchema, formatSchemaForPrompt, type SchemaInfo } from '../../database/schema-extractor.js';
import { maskSensitiveInfo } from '../../errors/index.js';

/**
 * nl2sql_schema 도구의 입력 스키마
 */
export const nl2sqlSchemaInputSchema = z.object({
  format: z
    .enum(['json', 'prompt', 'summary'])
    .default('json')
    .describe('Output format: json (full schema), prompt (AI-friendly text), summary (table list)'),
});

export type Nl2sqlSchemaInput = z.infer<typeof nl2sqlSchemaInputSchema>;

/**
 * nl2sql_schema 도구의 출력 인터페이스
 */
export interface Nl2sqlSchemaOutput {
  success: boolean;
  format: string;
  data?: SchemaInfo | string | SchemaSummary;
  error?: string;
}

/**
 * 스키마 요약 정보
 */
interface SchemaSummary {
  tableCount: number;
  tables: Array<{
    name: string;
    columnCount: number;
    comment?: string;
  }>;
}

/**
 * 스키마 정보를 요약 형식으로 변환합니다.
 */
function formatSchemaAsSummary(schema: SchemaInfo): SchemaSummary {
  return {
    tableCount: schema.tables.length,
    tables: schema.tables.map((table) => ({
      name: table.schemaName ? `${table.schemaName}.${table.name}` : table.name,
      columnCount: table.columns.length,
      comment: table.comment,
    })),
  };
}

/**
 * 데이터베이스 스키마 정보를 조회합니다.
 *
 * @param input - 출력 형식 옵션
 * @returns 스키마 정보
 */
export async function nl2sqlSchema(input: Nl2sqlSchemaInput): Promise<Nl2sqlSchemaOutput> {
  let config: Config;

  try {
    config = getConfig();
    validateConfig(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown configuration error';
    return {
      success: false,
      format: input.format,
      error: `Configuration error: ${maskSensitiveInfo(message)}`,
    };
  }

  try {
    const knex = createConnection(config);
    const schema = await extractSchema(knex, config);

    let data: SchemaInfo | string | SchemaSummary;

    switch (input.format) {
      case 'prompt':
        data = formatSchemaForPrompt(schema);
        break;
      case 'summary':
        data = formatSchemaAsSummary(schema);
        break;
      case 'json':
      default:
        data = schema;
        break;
    }

    return {
      success: true,
      format: input.format,
      data,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      format: input.format,
      error: `Schema extraction error: ${maskSensitiveInfo(message)}`,
    };
  } finally {
    await closeConnection();
  }
}
