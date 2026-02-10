/**
 * NL2SQL 메타데이터 타입 정의
 *
 * @description
 * 메타데이터 테이블에서 로드되는 데이터의 타입을 정의합니다.
 * 테이블 관계, 네이밍 컨벤션, 공통코드, 용어집, 쿼리 패턴 등을 포함합니다.
 *
 * @module database/metadata/types
 */

// =============================================================================
// 테이블 관계 타입
// =============================================================================

/**
 * 관계 타입
 */
export type RelationshipType =
  | 'ONE_TO_ONE'
  | 'ONE_TO_MANY'
  | 'MANY_TO_ONE'
  | 'MANY_TO_MANY';

/**
 * 신뢰도 레벨
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * 조인 힌트
 */
export type JoinHint = 'INNER' | 'LEFT' | 'RIGHT';

/**
 * 테이블 관계 정보
 */
export interface TableRelationship {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: RelationshipType;
  confidence: ConfidenceLevel;
  joinHint?: JoinHint;
  polymorphicTypeColumn?: string;
  polymorphicTypeValue?: string;
  description?: string;
}

// =============================================================================
// 네이밍 컨벤션 타입
// =============================================================================

/**
 * 네이밍 컨벤션 규칙
 */
export interface NamingConvention {
  name: string;
  columnPattern: string;
  targetTablePattern: string;
  targetColumnPattern: string;
  tablePrefixStrip?: string;
  tableSuffixStrip?: string;
  applyPluralization: boolean;
  priority: number;
  applyToSchemas?: string[];
  excludeTables?: string[];
  description?: string;
}

// =============================================================================
// 공통코드 타입
// =============================================================================

/**
 * 공통코드 테이블 설정
 */
export interface CodeTable {
  codeTableName: string;
  tableSchema: string;
  tableName: string;
  groupCodeColumn?: string;
  codeColumn: string;
  codeNameColumn: string;
  descriptionColumn?: string;
  sortOrderColumn?: string;
  activeFlagColumn?: string;
  activeFlagValue?: string;
  additionalFilter?: string;
  localeColumn?: string;
  defaultLocale?: string;
}

/**
 * 컬럼-코드 매핑
 */
export interface ColumnCodeMapping {
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  codeTableName: string;
  groupCode?: string;
  displayName?: string;
  includeInPrompt: boolean;
}

/**
 * 코드 별칭
 */
export interface CodeAlias {
  codeTableName: string;
  groupCode?: string;
  codeValue: string;
  alias: string;
  locale?: string;
}

/**
 * 코드 값 (동적 조회 결과)
 */
export interface CodeValue {
  groupCode?: string;
  code: string;
  name: string;
  description?: string;
}

// =============================================================================
// 용어집 타입
// =============================================================================

/**
 * 용어 카테고리
 */
export type GlossaryCategory =
  | 'TIME'
  | 'STATUS'
  | 'COMPARISON'
  | 'AGGREGATION'
  | 'BUSINESS'
  | 'CUSTOM';

/**
 * 용어집 항목
 */
export interface GlossaryTerm {
  termCode: string;
  term: string;
  category: GlossaryCategory;
  sqlCondition: string;
  sqlConditionPg?: string;
  sqlConditionMysql?: string;
  sqlConditionOracle?: string;
  applyToTables?: string[];
  requiredColumns?: string[];
  definition?: string;
  exampleUsage?: string;
  priority: number;
}

/**
 * 용어 별칭
 */
export interface GlossaryAlias {
  termCode: string;
  alias: string;
  locale?: string;
  matchType: 'EXACT' | 'CONTAINS' | 'REGEX';
}

/**
 * 용어 컨텍스트 (테이블별 조건 오버라이드)
 */
export interface GlossaryContext {
  termCode: string;
  contextSchema?: string;
  contextTable: string;
  sqlCondition: string;
  requiredColumns?: string[];
  contextDefinition?: string;
}

// =============================================================================
// 쿼리 패턴 타입
// =============================================================================

/**
 * 패턴 카테고리
 */
export type PatternCategory =
  | 'RANKING'
  | 'AGGREGATION'
  | 'TIME_SERIES'
  | 'COMPARISON'
  | 'SEARCH'
  | 'CUSTOM';

/**
 * 쿼리 패턴
 */
export interface QueryPattern {
  patternCode: string;
  patternName: string;
  category: PatternCategory;
  sqlTemplate: string;
  sqlTemplatePg?: string;
  sqlTemplateMysql?: string;
  sqlTemplateOracle?: string;
  applicableTables?: string[];
  requiredColumns?: string[];
  requiredJoins?: string[];
  matchScoreThreshold: number;
  priority: number;
  description?: string;
  exampleInput?: string;
  exampleOutput?: string;
}

/**
 * 패턴 파라미터 타입
 */
export type PatternParamType =
  | 'INTEGER'
  | 'STRING'
  | 'DATE'
  | 'COLUMN'
  | 'TABLE';

/**
 * 패턴 파라미터
 */
export interface PatternParameter {
  patternCode: string;
  paramName: string;
  paramType: PatternParamType;
  isRequired: boolean;
  defaultValue?: string;
  allowedValues?: string[];
  inferFromKeywords?: string[];
  inferFromColumnType?: string[];
  description?: string;
  displayOrder: number;
}

/**
 * 키워드 매칭 타입
 */
export type KeywordMatchType = 'EXACT' | 'CONTAINS' | 'REGEX';

/**
 * 패턴 키워드
 */
export interface PatternKeyword {
  patternCode: string;
  keyword: string;
  locale?: string;
  weight: number;
  matchType: KeywordMatchType;
  isRequired: boolean;
}

// =============================================================================
// 메타데이터 캐시 전체 타입
// =============================================================================

/**
 * 메타데이터 캐시 데이터
 */
export interface MetadataCache {
  /** 테이블 관계 목록 */
  relationships: TableRelationship[];

  /** 네이밍 컨벤션 규칙 */
  namingConventions: NamingConvention[];

  /** 공통코드 테이블 설정 */
  codeTables: CodeTable[];

  /** 컬럼-코드 매핑 */
  columnCodeMappings: ColumnCodeMapping[];

  /** 코드 별칭 */
  codeAliases: CodeAlias[];

  /** 용어집 */
  glossaryTerms: GlossaryTerm[];

  /** 용어 별칭 */
  glossaryAliases: GlossaryAlias[];

  /** 용어 컨텍스트 */
  glossaryContexts: GlossaryContext[];

  /** 쿼리 패턴 */
  queryPatterns: QueryPattern[];

  /** 패턴 파라미터 */
  patternParameters: PatternParameter[];

  /** 패턴 키워드 */
  patternKeywords: PatternKeyword[];

  /** 캐시 로드 시간 */
  loadedAt: Date;

  /** 데이터베이스 타입 */
  databaseType: 'postgresql' | 'mysql' | 'oracle';
}

/**
 * 메타데이터 쿼리 정의
 */
export interface MetadataQueryDefinition {
  sql: string;
  mapping: Record<string, string>;
  dynamicParams?: string[];
}

/**
 * DDL 테이블 정의
 */
export interface DdlTableDefinition {
  name: string;
  createSql: string;
  indexes?: string[];
}

/**
 * DDL 설정
 */
export interface DdlConfig {
  createSchema?: string;
  tables: DdlTableDefinition[];
}

/**
 * 메타데이터 쿼리 설정
 */
export interface MetadataQueryConfig {
  metadataSchema: string;
  queries: {
    relationships: MetadataQueryDefinition;
    namingConventions: MetadataQueryDefinition;
    codeTables: MetadataQueryDefinition;
    columnCodeMappings: MetadataQueryDefinition;
    codeAliases: MetadataQueryDefinition;
    glossaryTerms: MetadataQueryDefinition;
    glossaryAliases: MetadataQueryDefinition;
    glossaryContexts: MetadataQueryDefinition;
    queryPatterns: MetadataQueryDefinition;
    patternParameters: MetadataQueryDefinition;
    patternKeywords: MetadataQueryDefinition;
    codeValuesTemplate?: MetadataQueryDefinition;
  };
  ddl?: DdlConfig;
}
