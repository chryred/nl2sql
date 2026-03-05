/**
 * 용어집 자동 생성 모듈 (AI 기반)
 *
 * @description
 * 데이터베이스 스키마와 기존 메타데이터를 AI에 전달하여
 * 비즈니스 용어집(glossary_terms)을 자동으로 생성/추가합니다.
 *
 * @module database/glossary-generator
 */
import type { Knex } from 'knex';
import type { AIProvider } from '../ai/providers/openai.js';
import type { SchemaInfo } from './schema-extractor.js';
import type { MetadataCache } from './metadata/types.js';
import type { DatabaseType } from './types.js';
import { loadMetadataQueries } from './metadata/query-loader.js';
import { encodeForOracle, resolveOracleTextBind } from './charset-converter.js';
import { logger } from '../logger/index.js';

// ============================================================================
// 타입 정의
// ============================================================================

/**
 * AI가 생성한 용어집 후보
 */
export interface GlossaryTermCandidate {
  termCode: string;
  term: string;
  category: 'TIME' | 'STATUS' | 'COMPARISON' | 'AGGREGATION' | 'BUSINESS' | 'CUSTOM';
  sqlCondition: string;
  sqlConditionMysql?: string;
  sqlConditionOracle?: string;
  definition?: string;
  aliases?: string[];
}

// ============================================================================
// 시스템 프롬프트
// ============================================================================

export const GLOSSARY_SYSTEM_PROMPT = `You are a senior database analyst and Korean business domain expert.
Your task is to analyze a database schema and generate business glossary terms that map Korean natural language phrases to SQL conditions.

RULES:
1. Focus on terms users would naturally use in Korean queries
2. Categories: TIME (날짜/기간), STATUS (상태/분류), COMPARISON (비교/범위), AGGREGATION (집계), BUSINESS (비즈니스 도메인), CUSTOM (기타)
3. sqlCondition is PostgreSQL syntax (default)
4. Return ONLY a valid JSON array, no explanation
5. Skip terms already in the existing glossary
6. Generate 5-15 high-value terms that would most improve SQL generation accuracy

Each object must have exactly these fields:
{
  "termCode": "snake_case unique code (e.g., vip_customer, last_month)",
  "term": "Korean business term (e.g., VIP고객, 지난달)",
  "category": "TIME|STATUS|COMPARISON|AGGREGATION|BUSINESS|CUSTOM",
  "sqlCondition": "PostgreSQL WHERE clause condition (e.g., grade = 'VIP')",
  "sqlConditionMysql": "MySQL version (null if same as PostgreSQL)",
  "sqlConditionOracle": "Oracle version (null if same as PostgreSQL)",
  "definition": "Korean description of what this term means",
  "aliases": ["alternative Korean terms (optional array)"]
}

If no new valuable terms can be inferred, return [].`;

// ============================================================================
// 프롬프트 빌더
// ============================================================================

/**
 * 용어집 생성을 위한 AI 프롬프트를 빌드합니다.
 *
 * @param schema - 데이터베이스 스키마 정보
 * @param cache - 기존 메타데이터 캐시
 * @param dbType - DB 타입
 * @returns 사용자 프롬프트 문자열
 */
export function buildGlossaryPrompt(
  schema: SchemaInfo,
  cache: MetadataCache,
  dbType: DatabaseType
): string {
  const lines: string[] = [];

  lines.push(`## Database Type: ${dbType}`);
  lines.push('');

  // 스키마 테이블/컬럼 요약
  lines.push('## Schema Summary');
  const tables = schema.tables.slice(0, 30); // 최대 30개 테이블
  for (const table of tables) {
    const comment = table.comment ? ` -- ${table.comment}` : '';
    const schemaPrefix = table.schemaName ? `${table.schemaName}.` : '';
    lines.push(`TABLE: ${schemaPrefix}${table.name}${comment}`);
    const cols = table.columns.slice(0, 20);
    for (const col of cols) {
      const colComment = col.comment ? ` (${col.comment})` : '';
      lines.push(`  - ${col.name}: ${col.type}${colComment}`);
    }
  }
  lines.push('');

  // 기존 용어집 (중복 방지)
  if (cache.glossaryTerms.length > 0) {
    lines.push('## Existing Glossary Terms (DO NOT duplicate):');
    for (const t of cache.glossaryTerms) {
      lines.push(`  - ${t.termCode}: ${t.term} → ${t.sqlCondition}`);
    }
    lines.push('');
  }

  // 기존 관계 (컨텍스트)
  if (cache.relationships.length > 0) {
    lines.push('## Table Relationships:');
    for (const r of cache.relationships.slice(0, 20)) {
      lines.push(`  - ${r.sourceTable}.${r.sourceColumn} → ${r.targetTable}.${r.targetColumn}`);
    }
    lines.push('');
  }

  lines.push('Generate business glossary terms that would help translate Korean natural language queries to SQL.');
  lines.push('Focus on: date ranges, status filters, business metrics, comparison operators commonly used in queries.');

  return lines.join('\n');
}

// ============================================================================
// 응답 파서
// ============================================================================

/**
 * AI 응답에서 용어집 후보 배열을 파싱합니다.
 *
 * @param response - AI 응답 텍스트
 * @returns 파싱된 용어집 후보 배열
 */
export function parseGlossaryResponse(response: string): GlossaryTermCandidate[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GlossaryTermCandidate =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['termCode'] === 'string' &&
        typeof (item as Record<string, unknown>)['term'] === 'string' &&
        typeof (item as Record<string, unknown>)['sqlCondition'] === 'string'
    );
  } catch {
    logger.warn('Failed to parse glossary response', { response: response.slice(0, 200) });
    return [];
  }
}

// ============================================================================
// DB 적용
// ============================================================================

/**
 * 용어집 후보를 DB에 UPSERT합니다.
 *
 * @param knex - Knex 인스턴스
 * @param dbType - DB 타입
 * @param candidates - 용어집 후보 배열
 * @param charset - Oracle charset (선택)
 * @returns 적용된 항목 수
 */
export async function applyGlossaryTerms(
  knex: Knex,
  dbType: DatabaseType,
  candidates: GlossaryTermCandidate[],
  charset?: string
): Promise<number> {
  if (candidates.length === 0) return 0;

  const config = loadMetadataQueries(dbType);
  const upsertDef = config.queries.glossaryTermUpsert;
  if (!upsertDef) {
    throw new Error(`glossaryTermUpsert SQL not defined for ${dbType}`);
  }

  const aliasDef = config.queries.glossaryAliasUpsert;
  let applied = 0;

  for (const term of candidates) {
    try {
      const applyToTablesVal =
        dbType === 'postgresql'
          ? null
          : null; // auto-generated terms don't restrict to specific tables
      const requiredColumnsVal = dbType === 'postgresql' ? null : null;
      const priority = 50; // AI-generated terms have lower priority than manual

      let bindings: unknown[];

      if (dbType === 'oracle') {
        const mergedSql = resolveOracleTextBind(upsertDef.sql, charset);
        const encode = (v: string | undefined | null) =>
          v && charset ? encodeForOracle(v, charset) : (v ?? null);

        bindings = [
          // ON clause
          term.termCode,
          // WHEN MATCHED SET
          encode(term.term),
          term.category,
          encode(term.sqlCondition),
          encode(term.sqlConditionMysql ?? null),
          encode(term.sqlConditionOracle ?? null),
          null, // apply_to_tables
          null, // required_columns
          encode(term.definition ?? null),
          null, // example_usage
          priority,
          'ai_generated',
          // WHEN NOT MATCHED INSERT
          term.termCode,
          encode(term.term),
          term.category,
          encode(term.sqlCondition),
          encode(term.sqlConditionMysql ?? null),
          encode(term.sqlConditionOracle ?? null),
          null,
          null,
          encode(term.definition ?? null),
          null,
          priority,
          'ai_generated',
        ];
        await knex.raw(mergedSql, bindings);
      } else {
        // PostgreSQL / MySQL
        bindings = [
          term.termCode,
          term.term,
          term.category,
          term.sqlCondition,
          term.sqlConditionMysql ?? null,
          term.sqlConditionOracle ?? null,
          applyToTablesVal,
          requiredColumnsVal,
          term.definition ?? null,
          null, // example_usage
          priority,
          'ai_generated',
        ];
        await knex.raw(upsertDef.sql, bindings);
      }
      applied++;

      // 별칭 등록 (aliasDef 존재 시)
      if (aliasDef && term.aliases && term.aliases.length > 0) {
        for (const alias of term.aliases) {
          try {
            if (dbType === 'oracle') {
              const aliasSql = resolveOracleTextBind(aliasDef.sql, charset);
              const encodedAlias = alias && charset ? encodeForOracle(alias, charset) : alias;
              // Oracle MERGE for alias: ON(term_code + alias) + WHEN NOT MATCHED INSERT
              await knex.raw(aliasSql, [
                term.termCode, encodedAlias,
                term.termCode, encodedAlias, null, 'CONTAINS',
              ]);
            } else {
              await knex.raw(aliasDef.sql, [term.termCode, alias, null, 'CONTAINS']);
            }
          } catch {
            // alias insert failure is non-fatal
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to apply glossary term', {
        termCode: term.termCode,
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
 * AI를 사용하여 용어집 후보를 생성합니다.
 *
 * @param aiClient - AI 클라이언트
 * @param schema - 스키마 정보
 * @param cache - 메타데이터 캐시
 * @param dbType - DB 타입
 * @returns 생성된 용어집 후보 배열
 */
export async function generateGlossaryTerms(
  aiClient: AIProvider,
  schema: SchemaInfo,
  cache: MetadataCache,
  dbType: DatabaseType
): Promise<GlossaryTermCandidate[]> {
  const userPrompt = buildGlossaryPrompt(schema, cache, dbType);
  try {
    const response = await aiClient.generateComment(GLOSSARY_SYSTEM_PROMPT, userPrompt);
    return parseGlossaryResponse(response);
  } catch (err) {
    logger.warn('Glossary generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
