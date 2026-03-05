/**
 * 쿼리 패턴 자동 생성 모듈 (AI 기반)
 *
 * @description
 * 데이터베이스 스키마, 테이블 관계, 용어집을 기반으로
 * 자주 사용되는 쿼리 패턴을 AI로 자동 생성합니다.
 *
 * @module database/pattern-generator
 */
import type { Knex } from 'knex';
import type { AIProvider } from '../ai/providers/openai.js';
import type { SchemaInfo } from './schema-extractor.js';
import type { MetadataCache } from './metadata/types.js';
import type { DatabaseType } from './types.js';
import { loadMetadataQueries } from './metadata/query-loader.js';
import { buildPatternCode } from '../mcp/tools/query-pattern-manage.js';
import { encodeForOracle, resolveOracleTextBind } from './charset-converter.js';
import { logger } from '../logger/index.js';

// ============================================================================
// 타입 정의
// ============================================================================

/**
 * AI가 생성한 쿼리 패턴 후보
 */
export interface QueryPatternCandidate {
  patternName: string;
  category: 'AGGREGATION' | 'REPORT' | 'LOOKUP' | 'ANALYSIS' | 'COMPARISON' | 'TREND' | 'RANKING' | 'GENERAL';
  sqlTemplate: string;
  sqlTemplateMysql?: string;
  sqlTemplateOracle?: string;
  description: string;
  exampleInput?: string;
  keywords: string[];
  applicableTables?: string[];
}

// ============================================================================
// 시스템 프롬프트
// ============================================================================

const PATTERN_SYSTEM_PROMPT = `You are a senior SQL developer and Korean business analyst.
Your task is to generate reusable SQL query pattern templates based on a database schema.

RULES:
1. Generate 5-10 high-value, commonly-used query patterns
2. SQL templates should use {placeholder} syntax for dynamic values
3. Categories: AGGREGATION, REPORT, LOOKUP, ANALYSIS, COMPARISON, TREND, RANKING, GENERAL
4. sqlTemplate is PostgreSQL syntax (default)
5. Include Korean keywords that would trigger this pattern
6. Return ONLY a valid JSON array, no explanation

Each object must have exactly these fields:
{
  "patternName": "Descriptive name in Korean (e.g., '월별 매출 집계')",
  "category": "AGGREGATION|REPORT|LOOKUP|ANALYSIS|COMPARISON|TREND|RANKING|GENERAL",
  "sqlTemplate": "PostgreSQL SQL with {table}, {column} etc. as placeholders",
  "sqlTemplateMysql": "MySQL version (null if same)",
  "sqlTemplateOracle": "Oracle version (null if same)",
  "description": "Korean description of what this pattern does",
  "exampleInput": "Example natural language query in Korean",
  "keywords": ["Korean", "trigger", "keywords"],
  "applicableTables": ["table1", "table2"]
}`;

// ============================================================================
// 프롬프트 빌더
// ============================================================================

/**
 * 쿼리 패턴 생성을 위한 AI 프롬프트를 빌드합니다.
 *
 * @param schema - 데이터베이스 스키마 정보
 * @param cache - 메타데이터 캐시
 * @param dbType - DB 타입
 * @returns 사용자 프롬프트 문자열
 */
export function buildPatternPrompt(
  schema: SchemaInfo,
  cache: MetadataCache,
  dbType: DatabaseType
): string {
  const lines: string[] = [];

  lines.push(`## Database Type: ${dbType}`);
  lines.push('');

  // 테이블 요약 (주요 테이블 중심)
  lines.push('## Key Tables:');
  const tables = schema.tables.slice(0, 20);
  for (const table of tables) {
    const comment = table.comment ? ` -- ${table.comment}` : '';
    lines.push(`TABLE: ${table.name}${comment}`);
    const cols = table.columns.slice(0, 15);
    for (const col of cols) {
      const colComment = col.comment ? ` (${col.comment})` : '';
      const pk = col.isPrimaryKey ? ' [PK]' : '';
      lines.push(`  - ${col.name}: ${col.type}${pk}${colComment}`);
    }
  }
  lines.push('');

  // 관계 정보
  if (cache.relationships.length > 0) {
    lines.push('## Table Relationships:');
    for (const r of cache.relationships.slice(0, 15)) {
      const jh = r.joinHint ? ` (${r.joinHint} JOIN)` : '';
      lines.push(`  - ${r.sourceTable}.${r.sourceColumn} → ${r.targetTable}.${r.targetColumn}${jh}`);
    }
    lines.push('');
  }

  // 용어집 (쿼리 패턴 컨텍스트용)
  if (cache.glossaryTerms.length > 0) {
    lines.push('## Business Glossary (key terms):');
    for (const t of cache.glossaryTerms.slice(0, 15)) {
      lines.push(`  - ${t.term}: ${t.sqlCondition}`);
    }
    lines.push('');
  }

  // 기존 패턴 (중복 방지)
  if (cache.queryPatterns.length > 0) {
    lines.push('## Existing Patterns (DO NOT duplicate):');
    for (const p of cache.queryPatterns) {
      lines.push(`  - ${p.patternName}`);
    }
    lines.push('');
  }

  lines.push('Generate SQL query patterns that reflect common business reporting and analysis needs for this schema.');
  lines.push('Focus on: aggregations by time period, rankings, status-based filters, JOIN patterns between related tables.');

  return lines.join('\n');
}

// ============================================================================
// 응답 파서
// ============================================================================

/**
 * AI 응답에서 쿼리 패턴 후보를 파싱합니다.
 */
export function parsePatternResponse(response: string): QueryPatternCandidate[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueryPatternCandidate =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['patternName'] === 'string' &&
        typeof (item as Record<string, unknown>)['sqlTemplate'] === 'string' &&
        typeof (item as Record<string, unknown>)['description'] === 'string'
    );
  } catch {
    logger.warn('Failed to parse pattern response', { response: response.slice(0, 200) });
    return [];
  }
}

// ============================================================================
// DB 적용
// ============================================================================

/**
 * 쿼리 패턴 후보를 DB에 저장합니다.
 *
 * @param knex - Knex 인스턴스
 * @param dbType - DB 타입
 * @param candidates - 쿼리 패턴 후보 배열
 * @param charset - Oracle charset (선택)
 * @returns 적용된 항목 수
 */
export async function applyQueryPatterns(
  knex: Knex,
  dbType: DatabaseType,
  candidates: QueryPatternCandidate[],
  charset?: string
): Promise<number> {
  if (candidates.length === 0) return 0;

  const config = loadMetadataQueries(dbType);
  const insertDef = config.queries.queryPatternInsert;
  if (!insertDef) {
    throw new Error(`queryPatternInsert SQL not defined for ${dbType}`);
  }
  const kwDef = config.queries.queryPatternKeywordInsert;

  let applied = 0;

  for (const pattern of candidates) {
    const patternCode = buildPatternCode(pattern.patternName);
    try {
      // applicable_tables: PG=array, MySQL/Oracle=JSON
      const applicableTablesVal =
        dbType === 'postgresql'
          ? (pattern.applicableTables ?? null)
          : pattern.applicableTables
            ? JSON.stringify(pattern.applicableTables)
            : null;

      let bindings: unknown[];

      if (dbType === 'oracle') {
        const mergedSql = resolveOracleTextBind(insertDef.sql, charset);
        const encode = (v: string | undefined | null) =>
          v && charset ? encodeForOracle(v, charset) : (v ?? null);

        bindings = [
          // ON
          patternCode,
          // MATCHED SET
          encode(pattern.patternName),
          pattern.category,
          pattern.sqlTemplate,
          pattern.sqlTemplateMysql ?? null,
          pattern.sqlTemplateOracle ?? null,
          applicableTablesVal,
          encode(pattern.description),
          encode(pattern.exampleInput ?? null),
          // NOT MATCHED INSERT
          patternCode,
          encode(pattern.patternName),
          pattern.category,
          pattern.sqlTemplate,
          pattern.sqlTemplateMysql ?? null,
          pattern.sqlTemplateOracle ?? null,
          applicableTablesVal,
          70,
          100,
          encode(pattern.description),
          encode(pattern.exampleInput ?? null),
        ];
        await knex.raw(mergedSql, bindings);
      } else {
        bindings = [
          patternCode,
          pattern.patternName,
          pattern.category,
          pattern.sqlTemplate,
          pattern.sqlTemplateMysql ?? null,
          pattern.sqlTemplateOracle ?? null,
          applicableTablesVal,
          70,
          100,
          pattern.description,
          pattern.exampleInput ?? null,
        ];
        await knex.raw(insertDef.sql, bindings);
      }
      applied++;

      // 키워드 등록
      if (kwDef && pattern.keywords && pattern.keywords.length > 0) {
        for (const keyword of pattern.keywords) {
          try {
            if (dbType === 'oracle') {
              const kwSql = resolveOracleTextBind(kwDef.sql, charset);
              const encodedKw = keyword && charset ? encodeForOracle(keyword, charset) : keyword;
              await knex.raw(kwSql, [patternCode, encodedKw, patternCode, encodedKw]);
            } else {
              await knex.raw(kwDef.sql, [patternCode, keyword]);
            }
          } catch {
            // keyword insert failure is non-fatal
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to apply query pattern', {
        patternName: pattern.patternName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return applied;
}

// ============================================================================
// 메인 생성 함수
// ============================================================================

/**
 * AI를 사용하여 쿼리 패턴 후보를 생성합니다.
 *
 * @param aiClient - AI 클라이언트
 * @param schema - 스키마 정보
 * @param cache - 메타데이터 캐시
 * @param dbType - DB 타입
 * @returns 생성된 쿼리 패턴 후보 배열
 */
export async function generateQueryPatterns(
  aiClient: AIProvider,
  schema: SchemaInfo,
  cache: MetadataCache,
  dbType: DatabaseType
): Promise<QueryPatternCandidate[]> {
  const userPrompt = buildPatternPrompt(schema, cache, dbType);
  try {
    const response = await aiClient.generateComment(PATTERN_SYSTEM_PROMPT, userPrompt);
    return parsePatternResponse(response);
  } catch (err) {
    logger.warn('Pattern generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
