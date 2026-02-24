/**
 * 스키마 조회 도구
 *
 * @description
 * 데이터베이스 스키마 정보를 조회하여 반환합니다.
 * JSON, 프롬프트, 요약 형식 중 선택 가능합니다.
 * ConnectionManager를 통해 다중 연결을 지원합니다.
 *
 * @module mcp/tools/nl2sql-schema
 */

import { z } from 'zod';
import { getConfig, validateConfig, type Config } from '../../config/index.js';
import {
  createConnection,
  closeConnection,
} from '../../database/connection.js';
import {
  extractSchema,
  formatSchemaForPrompt,
  type SchemaInfo,
} from '../../database/schema-extractor.js';
import { maskSensitiveInfo } from '../../errors/index.js';
import { buildConfigFromEntry } from '../utils/config-helper.js';
import type { ConnectionManager } from '../../database/connection-manager.js';

/**
 * nl2sql_schema 도구의 입력 스키마
 */
export const nl2sqlSchemaInputSchema = z
  .object({
    tables: z
      .array(z.string())
      .optional()
      .describe(
        'Table names to retrieve schema for (case-insensitive). e.g. ["vip_grp_cust_inf"]. Optional if query is provided.'
      ),
    query: z
      .string()
      .optional()
      .describe(
        'Natural language description to infer related tables (e.g. "vip그룹고객조회"). Optional if tables is provided.'
      ),
    format: z
      .enum(['json', 'prompt', 'summary'])
      .default('json')
      .describe(
        'Output format: json (full schema), prompt (AI-friendly text), summary (table list)'
      ),
    connectionId: z
      .string()
      .optional()
      .describe(
        'Connection ID from db_connect (optional, uses default if omitted)'
      ),
  })
  .refine((data) => (data.tables && data.tables.length > 0) || data.query, {
    message: 'Either tables (non-empty array) or query must be provided',
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
 * 지정된 테이블명(대소문자 무시)으로 스키마를 필터링합니다.
 */
function filterSchemaByTables(schema: SchemaInfo, tables: string[] | undefined): SchemaInfo {
  if (!tables || tables.length === 0) return schema;
  const lowerTables = tables.map((t) => t.toLowerCase());
  return {
    ...schema,
    tables: schema.tables.filter((table) =>
      lowerTables.includes(table.name.toLowerCase())
    ),
  };
}

/**
 * 스키마를 포맷합니다.
 */
function formatSchema(
  schema: SchemaInfo,
  format: string
): SchemaInfo | string | SchemaSummary {
  switch (format) {
    case 'prompt':
      return formatSchemaForPrompt(schema);
    case 'summary':
      return formatSchemaAsSummary(schema);
    case 'json':
    default:
      return schema;
  }
}

/**
 * 데이터베이스 스키마 정보를 조회합니다.
 *
 * @param input - 출력 형식 옵션
 * @param connManager - ConnectionManager 인스턴스
 * @returns 스키마 정보
 */
export async function nl2sqlSchema(
  input: Nl2sqlSchemaInput,
  connManager: ConnectionManager
): Promise<Nl2sqlSchemaOutput> {
  // ConnectionManager에서 연결 해석
  const entry = connManager.resolve(input.connectionId);

  if (entry) {
    // ConnectionManager 경로
    try {
      const config = buildConfigFromEntry(entry);

      const rawSchema = await connManager.getOrInitSchemaCache(entry.connectionId, config)
        ?? await extractSchema(entry.knex, config);
      const schema = filterSchemaByTables(rawSchema, input.tables);
      const data = formatSchema(schema, input.format);

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
    }
  }

  // Legacy 폴백: 환경변수 기반
  return nl2sqlSchemaLegacy(input);
}

/**
 * 환경변수 기반 레거시 경로 (하위 호환).
 */
async function nl2sqlSchemaLegacy(
  input: Nl2sqlSchemaInput
): Promise<Nl2sqlSchemaOutput> {
  let config: Config;

  try {
    config = getConfig();
    validateConfig(config);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown configuration error';
    return {
      success: false,
      format: input.format,
      error: `Configuration error: ${maskSensitiveInfo(message)}. Use db_connect to establish a connection first.`,
    };
  }

  try {
    const knex = createConnection(config);
    const rawSchema = await extractSchema(knex, config);
    const schema = filterSchemaByTables(rawSchema, input.tables);
    const data = formatSchema(schema, input.format);

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
