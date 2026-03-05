/**
 * 코드 별칭 자동 생성 모듈 (AI 기반)
 *
 * @description
 * 코드테이블의 실제 코드값을 조회하고 AI로 한글 별칭을 생성합니다.
 * 생성된 별칭은 SQL 조건 생성 시 자연어 매핑에 활용됩니다.
 *
 * @module database/code-alias-generator
 */
import type { Knex } from 'knex';
import type { AIProvider } from '../ai/providers/openai.js';
import type { CodeTable } from './metadata/types.js';
import type { DatabaseType } from './types.js';
import { loadMetadataQueries } from './metadata/query-loader.js';
import { encodeForOracle, resolveOracleTextBind } from './charset-converter.js';
import { logger } from '../logger/index.js';

// ============================================================================
// 타입 정의
// ============================================================================

/**
 * DB에서 조회한 코드값
 */
export interface RawCodeValue {
  code: string;
  name: string;
  groupCode?: string;
}

/**
 * AI가 생성한 코드 별칭 후보
 */
export interface CodeAliasCandidate {
  codeTableName: string;
  groupCode?: string;
  codeValue: string;
  alias: string;
  locale: string;
}

// ============================================================================
// 프롬프트 빌더
// ============================================================================

/**
 * 코드 별칭 생성을 위한 AI 프롬프트를 빌드합니다.
 *
 * @param codeTableName - 코드테이블 이름
 * @param codeValues - 코드값 목록
 * @returns 사용자 프롬프트 문자열
 */
export function buildCodeAliasPrompt(
  codeTableName: string,
  codeValues: RawCodeValue[]
): string {
  const lines: string[] = [];
  lines.push(`Code table: ${codeTableName}`);
  lines.push('Code values:');
  for (const cv of codeValues) {
    const gc = cv.groupCode ? ` [group: ${cv.groupCode}]` : '';
    lines.push(`  - code="${cv.code}", name="${cv.name}"${gc}`);
  }
  lines.push('');
  lines.push('For each code value, generate natural Korean aliases that users might use in natural language queries.');
  lines.push('Return ONLY a valid JSON array. Each object must have:');
  lines.push('{ "codeValue": "...", "alias": "Korean alias", "groupCode": "..." or null }');
  lines.push('Generate multiple aliases per code value if appropriate (return multiple objects with same codeValue).');
  lines.push('If a code value already has a clear Korean name, still include the obvious aliases.');
  return lines.join('\n');
}

const CODE_ALIAS_SYSTEM_PROMPT = `You are a Korean database analyst.
Your task is to generate natural Korean aliases for code values in a code table.
These aliases will be used to match natural language Korean queries to code values.

Examples:
- code="A", name="Active" → aliases: ["활성", "사용중", "활성화됨"]
- code="Y", name="Yes" → aliases: ["예", "적용", "해당"]
- code="VIP", name="VIP" → aliases: ["VIP고객", "우수고객", "VIP"]

Return ONLY a valid JSON array, no explanation outside it.`;

// ============================================================================
// 응답 파서
// ============================================================================

/**
 * AI 응답에서 코드 별칭 후보를 파싱합니다.
 */
export function parseCodeAliasResponse(
  response: string,
  codeTableName: string
): CodeAliasCandidate[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>)['codeValue'] === 'string' &&
          typeof (item as Record<string, unknown>)['alias'] === 'string'
      )
      .map((item) => ({
        codeTableName,
        groupCode: typeof item['groupCode'] === 'string' ? item['groupCode'] : undefined,
        codeValue: String(item['codeValue']),
        alias: String(item['alias']),
        locale: 'ko',
      }));
  } catch {
    logger.warn('Failed to parse code alias response', { response: response.slice(0, 200) });
    return [];
  }
}

// ============================================================================
// 코드값 조회
// ============================================================================

/**
 * 코드테이블에서 실제 코드값을 조회합니다.
 *
 * @param knex - Knex 인스턴스
 * @param codeTable - 코드테이블 설정
 * @param dbType - DB 타입
 * @returns 코드값 목록
 */
export async function fetchCodeValues(
  knex: Knex,
  codeTable: CodeTable,
  dbType: DatabaseType
): Promise<RawCodeValue[]> {
  try {
    const schemaPrefix =
      dbType === 'oracle'
        ? codeTable.tableName
        : `${codeTable.tableSchema}.${codeTable.tableName}`;

    const nameCol = codeTable.codeNameColumn ?? codeTable.codeColumn;
    const gcCol = codeTable.groupCodeColumn;

    // SELECT code, name [, group_code] FROM table LIMIT 100
    const selectCols = [
      `${codeTable.codeColumn} AS code`,
      `${nameCol} AS name`,
      ...(gcCol ? [`${gcCol} AS group_code`] : []),
    ];

    let rows: Record<string, unknown>[];
    if (dbType === 'mysql') {
      const result = await knex.raw(
        `SELECT ${selectCols.join(', ')} FROM ${schemaPrefix} LIMIT 100`
      );
      rows = (result[0] as Record<string, unknown>[]) ?? [];
    } else {
      const limit = dbType === 'oracle' ? 'FETCH FIRST 100 ROWS ONLY' : 'LIMIT 100';
      const result = await knex.raw(
        `SELECT ${selectCols.join(', ')} FROM ${schemaPrefix} ${limit}`
      );
      rows = (result.rows as Record<string, unknown>[]) ?? [];
    }

    return rows.map((row) => ({
      code: String(row['code'] ?? ''),
      name: String(row['name'] ?? ''),
      groupCode: row['group_code'] ? String(row['group_code']) : undefined,
    }));
  } catch (err) {
    logger.warn('Failed to fetch code values', {
      codeTable: codeTable.codeTableName,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ============================================================================
// DB 적용
// ============================================================================

/**
 * 코드 별칭 후보를 DB에 저장합니다.
 *
 * @param knex - Knex 인스턴스
 * @param dbType - DB 타입
 * @param candidates - 코드 별칭 후보 배열
 * @param charset - Oracle charset (선택)
 * @returns 적용된 항목 수
 */
export async function applyCodeAliases(
  knex: Knex,
  dbType: DatabaseType,
  candidates: CodeAliasCandidate[],
  charset?: string
): Promise<number> {
  if (candidates.length === 0) return 0;

  const config = loadMetadataQueries(dbType);
  const aliasDef = config.queries.codeAliasUpsert;
  if (!aliasDef) {
    throw new Error(`codeAliasUpsert SQL not defined for ${dbType}`);
  }

  let applied = 0;

  for (const ca of candidates) {
    try {
      if (dbType === 'oracle') {
        const mergedSql = resolveOracleTextBind(aliasDef.sql, charset);
        const encode = (v: string | undefined | null) =>
          v && charset ? encodeForOracle(v, charset) : (v ?? null);

        // Oracle MERGE: ON(code_table_name, group_code, code_value, alias) + NOT MATCHED INSERT
        await knex.raw(mergedSql, [
          ca.codeTableName,
          ca.groupCode ?? null,
          ca.codeValue,
          encode(ca.alias),
          // INSERT values
          ca.codeTableName,
          ca.groupCode ?? null,
          ca.codeValue,
          encode(ca.alias),
          ca.locale,
        ]);
      } else {
        await knex.raw(aliasDef.sql, [
          ca.codeTableName,
          ca.groupCode ?? null,
          ca.codeValue,
          ca.alias,
          ca.locale,
        ]);
      }
      applied++;
    } catch (err) {
      logger.warn('Failed to apply code alias', {
        codeTableName: ca.codeTableName,
        codeValue: ca.codeValue,
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
 * 코드테이블 목록에 대해 AI로 코드 별칭을 일괄 생성합니다.
 *
 * @param aiClient - AI 클라이언트
 * @param knex - Knex 인스턴스
 * @param codeTables - 코드테이블 목록
 * @param dbType - DB 타입
 * @returns 생성된 코드 별칭 후보 배열
 */
export async function generateCodeAliases(
  aiClient: AIProvider,
  knex: Knex,
  codeTables: CodeTable[],
  dbType: DatabaseType
): Promise<CodeAliasCandidate[]> {
  const allCandidates: CodeAliasCandidate[] = [];

  for (const codeTable of codeTables) {
    const codeValues = await fetchCodeValues(knex, codeTable, dbType);
    if (codeValues.length === 0) continue;

    try {
      const userPrompt = buildCodeAliasPrompt(codeTable.codeTableName, codeValues);
      const response = await aiClient.generateComment(CODE_ALIAS_SYSTEM_PROMPT, userPrompt);
      const candidates = parseCodeAliasResponse(response, codeTable.codeTableName);
      allCandidates.push(...candidates);
    } catch (err) {
      logger.warn('Code alias generation failed for table', {
        codeTableName: codeTable.codeTableName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return allCandidates;
}
