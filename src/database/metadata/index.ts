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
  InferenceQueryDefinition,
  MetadataQueryConfig,
  DdlTableDefinition,
  DdlConfig,
} from './types.js';

// 캐시 함수 내보내기
export {
  initializeMetadataCache,
  getMetadataCache,
  refreshMetadataCache,
  invalidateMetadataCache,
  isMetadataCacheInitialized,
  getMetadataCacheStats,
  loadMetadataCacheIsolated,
} from './cache.js';

// 쿼리 로더 함수 내보내기
export {
  loadMetadataQueries,
  mapQueryResults,
  SUPPORTED_DB_TYPES,
  isValidDatabaseType,
} from './query-loader.js';

// 스키마 자동 생성 내보내기
export { setupMetadataSchema } from './schema-setup.js';
export type { SchemaSetupResult, TableSetupResult } from './schema-setup.js';

// 관계 추론 엔진 내보내기
export {
  inferRelationships,
  applyInferredRelationships,
  pluralize,
  singularize,
} from './relationship-inference.js';
export type {
  InferredRelationship,
  InferenceOptions,
  InferenceResult,
} from './relationship-inference.js';
