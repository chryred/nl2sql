/**
 * 메타데이터 모듈 내보내기
 *
 * @module database/metadata
 */

// 타입 내보내기
export type {
  RelationshipType,
  ConfidenceLevel,
  JoinHint,
  TableRelationship,
  NamingConvention,
  CodeTable,
  ColumnCodeMapping,
  CodeAlias,
  CodeValue,
  GlossaryCategory,
  GlossaryTerm,
  GlossaryAlias,
  GlossaryContext,
  PatternCategory,
  QueryPattern,
  PatternParamType,
  PatternParameter,
  KeywordMatchType,
  PatternKeyword,
  MetadataCache,
  MetadataQueryDefinition,
  MetadataQueryConfig,
} from './types.js';

// 캐시 함수 내보내기
export {
  initializeMetadataCache,
  getMetadataCache,
  refreshMetadataCache,
  invalidateMetadataCache,
  isMetadataCacheInitialized,
  getMetadataCacheStats,
} from './cache.js';

// 쿼리 로더 함수 내보내기
export {
  loadMetadataQueries,
  mapQueryResults,
  SUPPORTED_DB_TYPES,
  isValidDatabaseType,
} from './query-loader.js';
