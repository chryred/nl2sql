/**
 * MCP Tool: query_pattern_add / query_pattern_search
 *
 * query_pattern_add  - 자주 사용하는 쿼리 패턴을 DB에 등록하고 캐시 갱신
 * query_pattern_search - 패턴명/설명 키워드로 패턴 검색
 */
import { z } from 'zod';
import { maskSensitiveInfo } from '../../errors/index.js';
import { loadMetadataQueries } from '../../database/metadata/query-loader.js';
import type { ConnectionManager } from '../../database/connection-manager.js';

// ============================================================================
// 공통 유틸
// ============================================================================

/**
 * patternName → snake_case + 4자리 hex suffix
 * @param patternName - 패턴 이름
 * @returns 패턴 코드 (e.g. "monthly_sales_report_3f2a")
 */
export function buildPatternCode(patternName: string): string {
  const base = patternName
    .toLowerCase()
    .replace(/[가-힣]+/g, 'k')   // 한글 → 'k' (알파벳 문자로 대체)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'pattern'; // 빈 문자열 방지
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `${base}_${suffix}`;
}

/**
 * DB에서 반환된 keywords 컬럼 파싱
 * PostgreSQL: "{키워드1,키워드2}" 또는 string[] (드라이버 파싱)
 * MySQL/Oracle: "키워드1,키워드2" CSV
 * @param raw - DB 반환값
 * @returns 키워드 배열
 */
export function parseKeywordsResult(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  // PostgreSQL array (드라이버가 이미 배열로 파싱한 경우)
  if (Array.isArray(raw)) {
    return (raw as unknown[]).map(String).filter(Boolean);
  }
  if (typeof raw === 'string') {
    // PostgreSQL: {키워드1,키워드2} 형식
    if (raw.startsWith('{') && raw.endsWith('}')) {
      const inner = raw.slice(1, -1);
      return inner ? inner.split(',').filter(Boolean) : [];
    }
    // MySQL/Oracle: CSV 형식
    return raw.split(',').filter(Boolean);
  }
  return [];
}

// ============================================================================
// query_pattern_add
// ============================================================================

const PATTERN_CATEGORIES = [
  'AGGREGATION',
  'REPORT',
  'LOOKUP',
  'ANALYSIS',
  'COMPARISON',
  'TREND',
  'RANKING',
  'GENERAL',
] as const;

export const queryPatternAddInputSchema = z.object({
  connectionId: z.string().optional(),
  patternName: z.string().min(1).max(200),
  category: z.enum(PATTERN_CATEGORIES),
  sqlTemplate: z.string().min(1),
  sqlTemplateMysql: z.string().optional(),
  sqlTemplateOracle: z.string().optional(),
  description: z.string().min(1),
  exampleInput: z.string().optional(),
  applicableTables: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
});

export type QueryPatternAddInput = z.infer<typeof queryPatternAddInputSchema>;

export interface QueryPatternAddOutput {
  success: boolean;
  message: string;
  patternCode?: string;
  connectionId?: string;
  error?: string;
}

export async function queryPatternAdd(
  input: QueryPatternAddInput,
  connManager: ConnectionManager
): Promise<QueryPatternAddOutput> {
  const entry = connManager.resolve(input.connectionId);
  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
    };
  }

  const patternCode = buildPatternCode(input.patternName);
  const dbType = entry.params.type;

  try {
    const config = loadMetadataQueries(dbType);
    const insertDef = config.queries.queryPatternInsert;
    if (!insertDef) {
      return { success: false, message: `queryPatternInsert SQL not defined for ${dbType}` };
    }

    // applicable_tables: PG=TEXT[], MySQL/Oracle=JSON string
    const applicableTablesVal =
      dbType === 'postgresql'
        ? (input.applicableTables ?? null)
        : input.applicableTables
          ? JSON.stringify(input.applicableTables)
          : null;

    // Oracle MERGE INTO는 바인딩 순서: ON절 + MATCHED SET + NOT MATCHED INSERT
    let bindings: unknown[];
    if (dbType === 'oracle') {
      bindings = [
        // ON (SELECT ? AS pattern_code FROM DUAL)
        patternCode,
        // WHEN MATCHED SET
        input.patternName,
        input.category,
        input.sqlTemplate,
        input.sqlTemplateMysql ?? null,
        input.sqlTemplateOracle ?? null,
        applicableTablesVal,
        input.description,
        input.exampleInput ?? null,
        // WHEN NOT MATCHED INSERT VALUES
        patternCode,
        input.patternName,
        input.category,
        input.sqlTemplate,
        input.sqlTemplateMysql ?? null,
        input.sqlTemplateOracle ?? null,
        applicableTablesVal,
        70,
        100,
        input.description,
        input.exampleInput ?? null,
      ];
    } else {
      bindings = [
        patternCode,
        input.patternName,
        input.category,
        input.sqlTemplate,
        input.sqlTemplateMysql ?? null,
        input.sqlTemplateOracle ?? null,
        applicableTablesVal,
        70,
        100,
        input.description,
        input.exampleInput ?? null,
      ];
    }

    await entry.knex.raw(insertDef.sql, bindings);

    // 키워드 등록
    const kwDef = config.queries.queryPatternKeywordInsert;
    if (kwDef && input.keywords && input.keywords.length > 0) {
      for (const keyword of input.keywords) {
        const kwBindings: unknown[] =
          dbType === 'oracle'
            ? [patternCode, keyword, patternCode, keyword]
            : [patternCode, keyword];
        await entry.knex.raw(kwDef.sql, kwBindings);
      }
    }

    // 캐시 무효화 (다음 nl2sql_query 시 자동 재로드)
    connManager.invalidateCache(entry.connectionId);

    return {
      success: true,
      message: `Pattern '${input.patternName}' registered as '${patternCode}'`,
      patternCode,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to add query pattern',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

// ============================================================================
// query_pattern_search
// ============================================================================

export const queryPatternSearchInputSchema = z.object({
  connectionId: z.string().optional(),
  keyword: z.string().min(1),
  limit: z.number().int().positive().default(10),
});

export type QueryPatternSearchInput = z.infer<typeof queryPatternSearchInputSchema>;

export interface PatternSearchResult {
  patternCode: string;
  patternName: string;
  category: string;
  sqlTemplate: string;
  description?: string;
  exampleInput?: string;
  applicableTables: string[];
  keywords: string[];
}

export interface QueryPatternSearchOutput {
  success: boolean;
  message?: string;
  patterns?: PatternSearchResult[];
  connectionId?: string;
  error?: string;
}

export async function queryPatternSearch(
  input: QueryPatternSearchInput,
  connManager: ConnectionManager
): Promise<QueryPatternSearchOutput> {
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
    const searchDef = config.queries.queryPatternSearch;
    if (!searchDef) {
      return {
        success: false,
        message: `queryPatternSearch SQL not defined for ${entry.params.type}`,
      };
    }

    const likeKeyword = `%${input.keyword}%`;
    const result = await entry.knex.raw(searchDef.sql, [
      likeKeyword,
      likeKeyword,
      input.limit,
    ]);

    // 드라이버별 rows 추출
    let rows: Record<string, unknown>[];
    if (entry.params.type === 'postgresql') {
      rows = (result.rows as Record<string, unknown>[]) ?? [];
    } else if (entry.params.type === 'mysql') {
      rows = (result[0] as Record<string, unknown>[]) ?? [];
    } else {
      // Oracle
      rows = (result.rows as Record<string, unknown>[]) ?? [];
    }

    const patterns: PatternSearchResult[] = rows.map((row) => ({
      patternCode: String(row['pattern_code'] ?? ''),
      patternName: String(row['pattern_name'] ?? ''),
      category: String(row['category'] ?? ''),
      sqlTemplate: String(row['sql_template'] ?? ''),
      description: row['description'] != null ? String(row['description']) : undefined,
      exampleInput: row['example_input'] != null ? String(row['example_input']) : undefined,
      applicableTables: parseKeywordsResult(row['applicable_tables']),
      keywords: parseKeywordsResult(row['keywords']),
    }));

    return {
      success: true,
      patterns,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to search query patterns',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}
