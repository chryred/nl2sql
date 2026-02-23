/**
 * MCP 도구: 쿼리 이력 관리 (list, search, register)
 *
 * @description
 * nl2sql_query 실행 시 자동 저장되는 쿼리 이력을 조회하고,
 * 자주 사용하는 이력을 query_patterns로 승격(북마크화)합니다.
 *
 * @module mcp/tools/query-history
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import type { Knex } from 'knex';
import type { ConnectionManager } from '../../database/connection-manager.js';
import { loadMetadataQueries } from '../../database/metadata/query-loader.js';
import { maskSensitiveInfo } from '../../errors/index.js';
import type { DatabaseType } from '../../database/types.js';

// ============================================================================
// 입력 스키마
// ============================================================================

export const queryHistoryListInputSchema = z.object({
  connectionId: z.string().optional().describe('Database connection ID'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Max results to return'),
  sortBy: z
    .enum(['recent', 'frequent'])
    .default('recent')
    .describe('Sort order: recent (last_used_at) or frequent (usage_count)'),
});
export type QueryHistoryListInput = z.infer<typeof queryHistoryListInputSchema>;

export const queryHistorySearchInputSchema = z.object({
  connectionId: z.string().optional().describe('Database connection ID'),
  keyword: z
    .string()
    .min(1)
    .describe('Keyword to search in natural language queries'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe('Max results to return'),
});
export type QueryHistorySearchInput = z.infer<
  typeof queryHistorySearchInputSchema
>;

export const queryHistoryRegisterInputSchema = z.object({
  connectionId: z.string().optional().describe('Database connection ID'),
  historyId: z
    .number()
    .int()
    .min(1)
    .describe('History entry ID to promote to query_patterns'),
  patternName: z.string().min(1).describe('Human-readable pattern name'),
  description: z.string().min(1).describe('Pattern description'),
  category: z
    .enum([
      'AGGREGATION',
      'REPORT',
      'LOOKUP',
      'ANALYSIS',
      'COMPARISON',
      'TREND',
      'RANKING',
      'GENERAL',
    ])
    .optional()
    .describe('Pattern category'),
  keywords: z
    .array(z.string())
    .optional()
    .describe('Keywords for pattern matching'),
});
export type QueryHistoryRegisterInput = z.infer<
  typeof queryHistoryRegisterInputSchema
>;

// ============================================================================
// 출력 인터페이스
// ============================================================================

interface HistoryEntry {
  id: number;
  natural_query: string;
  generated_sql: string | null;
  connection_id: string | null;
  executed: boolean | number;
  usage_count: number;
  last_used_at: string;
  created_at?: string;
}

export interface QueryHistoryListOutput {
  success: boolean;
  entries?: HistoryEntry[];
  total?: number;
  message?: string;
  connectionId?: string;
  error?: string;
}

export interface QueryHistorySearchOutput {
  success: boolean;
  entries?: HistoryEntry[];
  total?: number;
  message?: string;
  connectionId?: string;
  error?: string;
}

export interface QueryHistoryRegisterOutput {
  success: boolean;
  message?: string;
  patternCode?: string;
  connectionId?: string;
  error?: string;
}

// ============================================================================
// 내부 유틸리티
// ============================================================================

/** 자연어 쿼리 정규화 후 SHA256 해시 반환 */
export function hashQuery(q: string): string {
  const normalized = q.toLowerCase().trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * nl2sql_query 성공 후 query_history에 자동 저장 (fire-and-forget)
 * 동일 해시면 usage_count + 1 & last_used_at 갱신 (UPSERT)
 */
export async function saveQueryHistory(
  knex: Knex,
  dbType: DatabaseType,
  naturalQuery: string,
  generatedSql: string,
  connectionId: string,
  executed: boolean
): Promise<void> {
  const config = loadMetadataQueries(dbType);
  const def = config.queries.queryHistoryUpsert;
  if (!def) return; // query_history 미설치 시 조용히 스킵

  const hash = hashQuery(naturalQuery);
  const execVal =
    dbType === 'mysql' || dbType === 'oracle' ? (executed ? 1 : 0) : executed;

  let bindings: unknown[];
  if (dbType === 'oracle') {
    // MERGE: ON(1) + MATCHED SET(3) + NOT MATCHED INSERT(5)
    bindings = [
      hash, // ON: query_hash
      generatedSql, // MATCHED: generated_sql
      execVal, // MATCHED: executed
      hash, // NOT MATCHED: query_hash
      naturalQuery, // NOT MATCHED: natural_query
      generatedSql, // NOT MATCHED: generated_sql
      connectionId, // NOT MATCHED: connection_id
      execVal, // NOT MATCHED: executed
    ];
  } else {
    bindings = [hash, naturalQuery, generatedSql, connectionId, execVal];
  }

  await knex.raw(def.sql, bindings);
}

// ============================================================================
// MCP 도구 함수
// ============================================================================

/** 쿼리 이력 목록 조회 (최신순 or 자주 사용순) */
export async function queryHistoryList(
  input: QueryHistoryListInput,
  connManager: ConnectionManager
): Promise<QueryHistoryListOutput> {
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
    const config = loadMetadataQueries(entry.params.type);
    const queryKey =
      input.sortBy === 'frequent'
        ? 'queryHistoryListFrequent'
        : 'queryHistoryListRecent';
    const def = config.queries[queryKey];
    if (!def) {
      return {
        success: false,
        message: `${queryKey} SQL not defined for ${entry.params.type}. Run schema_setup first.`,
      };
    }

    const result = await entry.knex.raw(def.sql, [input.limit]);
    const rows = (result.rows ?? result[0] ?? []) as HistoryEntry[];

    return {
      success: true,
      entries: rows,
      total: rows.length,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to list query history',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

/** 쿼리 이력 자연어 키워드 검색 */
export async function queryHistorySearch(
  input: QueryHistorySearchInput,
  connManager: ConnectionManager
): Promise<QueryHistorySearchOutput> {
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
    const config = loadMetadataQueries(entry.params.type);
    const def = config.queries.queryHistorySearch;
    if (!def) {
      return {
        success: false,
        message: `queryHistorySearch SQL not defined for ${entry.params.type}. Run schema_setup first.`,
      };
    }

    const keyword = `%${input.keyword}%`;
    const result = await entry.knex.raw(def.sql, [keyword, input.limit]);
    const rows = (result.rows ?? result[0] ?? []) as HistoryEntry[];

    return {
      success: true,
      entries: rows,
      total: rows.length,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to search query history',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

/** 쿼리 이력 항목을 query_patterns로 승격 (북마크화) */
export async function queryHistoryRegister(
  input: QueryHistoryRegisterInput,
  connManager: ConnectionManager
): Promise<QueryHistoryRegisterOutput> {
  const entry = connManager.resolve(input.connectionId);
  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
    };
  }

  const dbType = entry.params.type;
  const config = loadMetadataQueries(dbType);

  // 1. 이력 항목 조회
  const getByIdDef = config.queries.queryHistoryGetById;
  if (!getByIdDef) {
    return {
      success: false,
      message: `queryHistoryGetById SQL not defined for ${dbType}.`,
    };
  }

  let historyRow: HistoryEntry | undefined;
  try {
    const result = await entry.knex.raw(getByIdDef.sql, [input.historyId]);
    const rows = (result.rows ?? result[0] ?? []) as HistoryEntry[];
    historyRow = rows[0];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to fetch history entry',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }

  if (!historyRow) {
    return {
      success: false,
      message: `History entry #${input.historyId} not found`,
      connectionId: entry.connectionId,
    };
  }

  if (!historyRow.generated_sql) {
    return {
      success: false,
      message: `History entry #${input.historyId} has no generated SQL to promote`,
      connectionId: entry.connectionId,
    };
  }

  // 2. pattern_code 생성 (패턴 이름 → slug)
  const patternCode = input.patternName
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);

  // 3. query_patterns에 UPSERT
  const insertDef = config.queries.queryPatternInsert;
  if (!insertDef) {
    return {
      success: false,
      message: `queryPatternInsert SQL not defined for ${dbType}.`,
    };
  }

  try {
    let bindings: unknown[];
    if (dbType === 'oracle') {
      // MERGE: ON(1) + MATCHED SET(8) + NOT MATCHED INSERT(11)
      bindings = [
        patternCode,
        input.patternName,
        input.category ?? null,
        historyRow.generated_sql,
        null,
        null,
        null,
        input.description,
        historyRow.natural_query,
        patternCode,
        input.patternName,
        input.category ?? null,
        historyRow.generated_sql,
        null,
        null,
        null,
        70,
        100,
        input.description,
        historyRow.natural_query,
      ];
    } else {
      bindings = [
        patternCode,
        input.patternName,
        input.category ?? null,
        historyRow.generated_sql,
        null,
        null,
        null,
        70,
        100,
        input.description,
        historyRow.natural_query,
      ];
    }

    await entry.knex.raw(insertDef.sql, bindings);

    // 키워드 등록
    const kwDef = config.queries.queryPatternKeywordInsert;
    if (kwDef && input.keywords && input.keywords.length > 0) {
      for (const kw of input.keywords) {
        const kwBindings =
          dbType === 'oracle'
            ? [patternCode, kw, patternCode, kw]
            : [patternCode, kw];
        await entry.knex.raw(kwDef.sql, kwBindings);
      }
    }

    // 캐시 무효화 (다음 nl2sql_query에서 패턴 반영)
    connManager.invalidateCache(entry.connectionId);

    return {
      success: true,
      message: `History #${input.historyId} promoted to pattern '${patternCode}'`,
      patternCode,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to register pattern from history',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}
