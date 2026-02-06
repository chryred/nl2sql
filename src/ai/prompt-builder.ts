/**
 * AI 프롬프트 빌더 모듈
 *
 * @description
 * 자연어 쿼리를 SQL로 변환하기 위한 AI 프롬프트를 구성합니다.
 * 데이터베이스 스키마, 성능 가이드라인, 안전 지침 등을 포함하여
 * AI 모델이 최적의 SQL을 생성할 수 있도록 컨텍스트를 제공합니다.
 *
 * @module ai/prompt-builder
 *
 * @example
 * import { buildPrompt } from './prompt-builder';
 *
 * const prompt = buildPrompt({
 *   tables: schema,
 *   naturalLanguageQuery: '최근 30일간 가입한 사용자 수',
 *   dbType: 'postgresql'
 * });
 */

import {
  formatSchemaForPrompt,
  formatIndexesForPrompt,
  type SchemaInfo,
  type TableInfo,
} from '../database/schema-extractor.js';
import type { DatabaseType } from '../database/types.js';
import type { MetadataCache } from '../database/metadata/types.js';

/**
 * 프롬프트 빌더 옵션 인터페이스
 *
 * @description
 * buildPrompt 함수에 전달할 옵션을 정의합니다.
 */
export interface PromptOptions {
  /** 테이블 정보 배열 또는 스키마 정보 */
  tables: TableInfo[] | SchemaInfo;
  /** 사용자의 자연어 쿼리 */
  naturalLanguageQuery: string;
  /** 대상 데이터베이스 타입 */
  dbType: DatabaseType;
  /** 메타데이터 캐시 (선택적) */
  metadata?: MetadataCache | null;
}

/**
 * 데이터베이스별 SQL 문법 가이드를 생성합니다.
 *
 * @description
 * 각 데이터베이스의 고유한 SQL 문법과 함수를 안내하는 텍스트를 생성합니다.
 * AI 모델이 해당 데이터베이스에 맞는 올바른 SQL을 생성할 수 있도록 합니다.
 *
 * @param dbType - 데이터베이스 타입
 * @returns 데이터베이스별 SQL 가이드 텍스트
 * @private
 */
function getDbSpecificNotes(dbType: DatabaseType): string {
  switch (dbType) {
    case 'mysql':
      return `- Use MySQL-specific syntax (backticks for identifiers, LIMIT syntax, etc.)
- Use appropriate MySQL functions (e.g., IFNULL, DATE_FORMAT, CONCAT, etc.)
- Use LIMIT for result set restriction
- String comparison is case-insensitive by default`;

    case 'oracle':
      return `- Use Oracle-specific syntax (double quotes for case-sensitive identifiers)
- Use appropriate Oracle functions (e.g., NVL, TO_CHAR, TO_DATE, DECODE, etc.)
- Use FETCH FIRST n ROWS ONLY for limiting results (Oracle 12c+) or ROWNUM for older versions
- Use || for string concatenation
- NULL handling: NVL(column, default) or COALESCE
- Date literals: DATE 'YYYY-MM-DD' or TO_DATE('YYYY-MM-DD', 'YYYY-MM-DD')
- Use DUAL for queries without a table (e.g., SELECT SYSDATE FROM DUAL)`;

    default: // postgresql
      return `- Use PostgreSQL-specific syntax (double quotes for identifiers if needed)
- Use appropriate PostgreSQL functions (e.g., COALESCE, TO_CHAR, etc.)
- Use LIMIT for result set restriction
- Use :: for type casting (e.g., column::text)
- Use ILIKE for case-insensitive pattern matching`;
  }
}

/**
 * 쿼리 성능 가이드라인을 생성합니다.
 *
 * @description
 * 효율적인 SQL 쿼리 작성을 위한 가이드라인과
 * 사용 가능한 인덱스 정보를 포함한 텍스트를 생성합니다.
 *
 * @param schema - 스키마 정보 또는 테이블 정보 배열
 * @returns 성능 가이드라인 텍스트
 * @private
 */
function getPerformanceGuidelines(schema: SchemaInfo | TableInfo[]): string {
  const tables = Array.isArray(schema) ? schema : schema.tables;
  const indexInfo = formatIndexesForPrompt(tables);

  const lines: string[] = [
    'Performance Guidelines:',
    '- Prefer filtering on indexed columns for better query performance',
    '- Always use WHERE clauses to limit result sets when possible',
    '- Avoid SELECT * in production queries - select only needed columns',
    '- Use LIMIT/FETCH to prevent unbounded result sets',
    '- Prefer EXISTS over IN for large subqueries',
    '- Use table aliases for readability when joining tables',
  ];

  if (indexInfo) {
    lines.push('');
    lines.push(indexInfo);
  }

  return lines.join('\n');
}

/**
 * 쿼리 안전 가이드라인을 생성합니다.
 *
 * @description
 * SQL 인젝션 방지 및 데이터 보호를 위한 안전 지침을 제공합니다.
 *
 * @returns 안전 가이드라인 텍스트
 * @private
 */
function getQuerySafetyGuidelines(): string {
  return `Query Safety:
- Never generate DELETE or DROP statements without explicit WHERE clause
- Avoid modifying data unless explicitly requested
- Use parameterized queries pattern when showing examples with variables`;
}

/**
 * 메타데이터를 프롬프트 텍스트로 포맷팅합니다.
 *
 * @param metadata - 메타데이터 캐시
 * @param dbType - 데이터베이스 타입
 * @returns 메타데이터 프롬프트 텍스트
 * @private
 */
function formatMetadataForPrompt(
  metadata: MetadataCache,
  dbType: DatabaseType
): string {
  const sections: string[] = [];

  // 테이블 관계 정보
  if (metadata.relationships.length > 0) {
    const relationshipLines = metadata.relationships.map((rel) => {
      const joinType = rel.joinHint
        ? ` (${rel.joinHint} JOIN recommended)`
        : '';
      return `  - ${rel.sourceTable}.${rel.sourceColumn} -> ${rel.targetTable}.${rel.targetColumn} (${rel.relationshipType})${joinType}`;
    });
    sections.push(`Table Relationships:\n${relationshipLines.join('\n')}`);
  }

  // 용어집 (비즈니스 용어 → SQL 조건 매핑)
  if (metadata.glossaryTerms.length > 0) {
    const glossaryLines = metadata.glossaryTerms.map((term) => {
      // DB 타입별 SQL 조건 선택
      let sqlCondition = term.sqlCondition;
      if (dbType === 'postgresql' && term.sqlConditionPg) {
        sqlCondition = term.sqlConditionPg;
      } else if (dbType === 'mysql' && term.sqlConditionMysql) {
        sqlCondition = term.sqlConditionMysql;
      } else if (dbType === 'oracle' && term.sqlConditionOracle) {
        sqlCondition = term.sqlConditionOracle;
      }
      const definition = term.definition ? ` - ${term.definition}` : '';
      return `  - "${term.term}" → ${sqlCondition}${definition}`;
    });
    sections.push(
      `Business Terms (use these SQL conditions when user mentions these terms):\n${glossaryLines.join('\n')}`
    );
  }

  // 용어 별칭 (동의어)
  if (metadata.glossaryAliases.length > 0) {
    const aliasMap = new Map<string, string[]>();
    metadata.glossaryAliases.forEach((alias) => {
      const existing = aliasMap.get(alias.termCode) || [];
      existing.push(alias.alias);
      aliasMap.set(alias.termCode, existing);
    });

    const aliasLines: string[] = [];
    aliasMap.forEach((aliases, termCode) => {
      const term = metadata.glossaryTerms.find((t) => t.termCode === termCode);
      if (term) {
        aliasLines.push(
          `  - "${term.term}" also known as: ${aliases.join(', ')}`
        );
      }
    });
    if (aliasLines.length > 0) {
      sections.push(`Term Aliases (synonyms):\n${aliasLines.join('\n')}`);
    }
  }

  // 쿼리 패턴
  if (metadata.queryPatterns.length > 0) {
    const patternLines = metadata.queryPatterns.slice(0, 10).map((pattern) => {
      // DB 타입별 SQL 템플릿 선택
      let template = pattern.sqlTemplate;
      if (dbType === 'postgresql' && pattern.sqlTemplatePg) {
        template = pattern.sqlTemplatePg;
      } else if (dbType === 'mysql' && pattern.sqlTemplateMysql) {
        template = pattern.sqlTemplateMysql;
      } else if (dbType === 'oracle' && pattern.sqlTemplateOracle) {
        template = pattern.sqlTemplateOracle;
      }
      const example = pattern.exampleInput
        ? ` (e.g., "${pattern.exampleInput}")`
        : '';
      return `  - ${pattern.patternName}${example}:\n    ${template}`;
    });
    sections.push(`Common Query Patterns:\n${patternLines.join('\n')}`);
  }

  // 패턴 키워드 (사용자가 특정 키워드를 언급하면 해당 패턴 사용)
  if (metadata.patternKeywords.length > 0) {
    const keywordMap = new Map<string, string[]>();
    metadata.patternKeywords.forEach((kw) => {
      const existing = keywordMap.get(kw.patternCode) || [];
      existing.push(kw.keyword);
      keywordMap.set(kw.patternCode, existing);
    });

    const keywordLines: string[] = [];
    keywordMap.forEach((keywords, patternCode) => {
      const pattern = metadata.queryPatterns.find(
        (p) => p.patternCode === patternCode
      );
      if (pattern) {
        keywordLines.push(
          `  - Keywords [${keywords.join(', ')}] → use "${pattern.patternName}" pattern`
        );
      }
    });
    if (keywordLines.length > 0) {
      sections.push(
        `Pattern Keywords (when user mentions these, consider the corresponding pattern):\n${keywordLines.join('\n')}`
      );
    }
  }

  return sections.length > 0
    ? `Domain-Specific Metadata:\n\n${sections.join('\n\n')}`
    : '';
}

/**
 * AI 모델용 SQL 생성 프롬프트를 구성합니다.
 *
 * @description
 * 다음 요소들을 포함한 종합적인 프롬프트를 생성합니다:
 * - 데이터베이스 스키마 정보 (테이블, 컬럼, 인덱스)
 * - 데이터베이스별 SQL 문법 가이드
 * - 쿼리 성능 최적화 가이드라인
 * - 보안 및 안전 지침
 * - 사용자의 자연어 요청
 *
 * @param options - 프롬프트 생성 옵션
 * @returns 완성된 프롬프트 문자열
 *
 * @example
 * const prompt = buildPrompt({
 *   tables: schema,
 *   naturalLanguageQuery: '최근 7일간 주문 총액',
 *   dbType: 'postgresql'
 * });
 *
 * const sql = await aiClient.generateSQL(prompt);
 */
export function buildPrompt(options: PromptOptions): string {
  const { tables, naturalLanguageQuery, dbType, metadata } = options;
  const schemaText = formatSchemaForPrompt(tables);
  const dbSpecificNotes = getDbSpecificNotes(dbType);
  const performanceGuidelines = getPerformanceGuidelines(tables);
  const safetyGuidelines = getQuerySafetyGuidelines();

  // 메타데이터 섹션 (있는 경우에만 추가)
  const metadataSection = metadata
    ? formatMetadataForPrompt(metadata, dbType)
    : '';

  const sections = [
    `Given the following database schema:`,
    schemaText,
    `Database type: ${dbType.toUpperCase()}`,
    `Guidelines:\n${dbSpecificNotes}`,
    performanceGuidelines,
    safetyGuidelines,
  ];

  // 메타데이터가 있으면 추가
  if (metadataSection) {
    sections.push(metadataSection);
  }

  sections.push(`User request: ${naturalLanguageQuery}`);
  sections.push(
    `Generate a valid, efficient SQL query that fulfills the user's request:`
  );

  return sections.join('\n\n');
}
