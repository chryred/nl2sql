/**
 * NL2SQL 메타데이터 캐시 관리
 *
 * @description
 * 싱글톤 패턴으로 메타데이터를 메모리에 캐싱합니다.
 * 서버 시작 시 한 번 로드하여 SQL 생성 시 반복 조회를 방지합니다.
 *
 * @module database/metadata/cache
 */

import type { Knex } from 'knex';
import type {
  MetadataCache,
  MetadataQueryConfig,
  TableRelationship,
  NamingConvention,
  CodeTable,
  ColumnCodeMapping,
  CodeAlias,
  GlossaryTerm,
  GlossaryAlias,
  GlossaryContext,
  QueryPattern,
  PatternParameter,
  PatternKeyword,
} from './types.js';
import type { DatabaseType } from '../types.js';
import { loadMetadataQueries, mapQueryResults } from './query-loader.js';
import { logger } from '../../logger/index.js';

/**
 * 메타데이터 캐시 싱글톤 인스턴스
 */
let cacheInstance: MetadataCache | null = null;

/**
 * 캐시 초기화 진행 중 플래그
 */
let isInitializing = false;

/**
 * 초기화 대기 프로미스
 */
let initPromise: Promise<MetadataCache> | null = null;

/**
 * 메타데이터를 데이터베이스에서 로드하여 캐시에 저장합니다.
 *
 * @param knex - Knex 데이터베이스 연결
 * @param dbType - 데이터베이스 타입
 * @returns 로드된 메타데이터 캐시
 * @throws 로드 실패 시 Error
 *
 * @example
 * const cache = await initializeMetadataCache(knex, 'postgresql');
 */
export async function initializeMetadataCache(
  knex: Knex,
  dbType: DatabaseType
): Promise<MetadataCache> {
  // 이미 초기화 중이면 대기
  if (isInitializing && initPromise) {
    return initPromise;
  }

  // 이미 캐시가 있으면 반환
  if (cacheInstance && cacheInstance.databaseType === dbType) {
    logger.debug('Using existing metadata cache');
    return cacheInstance;
  }

  isInitializing = true;

  initPromise = (async () => {
    try {
      logger.info(`Initializing metadata cache for ${dbType}...`);

      // 쿼리 설정 로드
      const queryConfig = loadMetadataQueries(dbType);

      // 메타데이터 스키마 존재 여부 확인
      const schemaExists = await checkMetadataSchemaExists(knex, dbType, queryConfig.metadataSchema);

      if (!schemaExists) {
        logger.warn(`Metadata schema '${queryConfig.metadataSchema}' not found. Using empty cache.`);
        cacheInstance = createEmptyCache(dbType);
        return cacheInstance;
      }

      // 각 메타데이터 테이블 로드
      const [
        relationships,
        namingConventions,
        codeTables,
        columnCodeMappings,
        codeAliases,
        glossaryTerms,
        glossaryAliases,
        glossaryContexts,
        queryPatterns,
        patternParameters,
        patternKeywords,
      ] = await Promise.all([
        loadRelationships(knex, queryConfig),
        loadNamingConventions(knex, queryConfig),
        loadCodeTables(knex, queryConfig),
        loadColumnCodeMappings(knex, queryConfig),
        loadCodeAliases(knex, queryConfig),
        loadGlossaryTerms(knex, queryConfig),
        loadGlossaryAliases(knex, queryConfig),
        loadGlossaryContexts(knex, queryConfig),
        loadQueryPatterns(knex, queryConfig),
        loadPatternParameters(knex, queryConfig),
        loadPatternKeywords(knex, queryConfig),
      ]);

      cacheInstance = {
        relationships,
        namingConventions,
        codeTables,
        columnCodeMappings,
        codeAliases,
        glossaryTerms,
        glossaryAliases,
        glossaryContexts,
        queryPatterns,
        patternParameters,
        patternKeywords,
        loadedAt: new Date(),
        databaseType: dbType,
      };

      logger.info(`Metadata cache initialized successfully:
        - Relationships: ${relationships.length}
        - Naming Conventions: ${namingConventions.length}
        - Code Tables: ${codeTables.length}
        - Column Code Mappings: ${columnCodeMappings.length}
        - Code Aliases: ${codeAliases.length}
        - Glossary Terms: ${glossaryTerms.length}
        - Glossary Aliases: ${glossaryAliases.length}
        - Glossary Contexts: ${glossaryContexts.length}
        - Query Patterns: ${queryPatterns.length}
        - Pattern Parameters: ${patternParameters.length}
        - Pattern Keywords: ${patternKeywords.length}
      `);

      return cacheInstance;
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Failed to initialize metadata cache', error);
      }
      // 에러 발생 시 빈 캐시 반환 (graceful degradation)
      cacheInstance = createEmptyCache(dbType);
      return cacheInstance;
    } finally {
      isInitializing = false;
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * 메타데이터 스키마 존재 여부를 확인합니다.
 */
async function checkMetadataSchemaExists(
  knex: Knex,
  dbType: DatabaseType,
  schemaName: string
): Promise<boolean> {
  try {
    let query: string;

    switch (dbType) {
      case 'postgresql':
        query = `SELECT 1 FROM information_schema.schemata WHERE schema_name = '${schemaName}'`;
        break;
      case 'mysql':
        query = `SELECT 1 FROM information_schema.schemata WHERE schema_name = '${schemaName}'`;
        break;
      case 'oracle':
        query = `SELECT 1 FROM all_users WHERE username = UPPER('${schemaName}')`;
        break;
      default:
        return false;
    }

    const result = await knex.raw(query);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const rows = dbType === 'oracle' ? result : (result.rows || result);
    return Array.isArray(rows) ? rows.length > 0 : false;
  } catch {
    return false;
  }
}

/**
 * 빈 캐시를 생성합니다.
 */
function createEmptyCache(dbType: DatabaseType): MetadataCache {
  return {
    relationships: [],
    namingConventions: [],
    codeTables: [],
    columnCodeMappings: [],
    codeAliases: [],
    glossaryTerms: [],
    glossaryAliases: [],
    glossaryContexts: [],
    queryPatterns: [],
    patternParameters: [],
    patternKeywords: [],
    loadedAt: new Date(),
    databaseType: dbType,
  };
}

/**
 * 안전하게 쿼리를 실행합니다.
 */
async function safeQuery<T>(
  knex: Knex,
  sql: string,
  mapping: Record<string, string>,
  tableName: string
): Promise<T[]> {
  try {
    const result = await knex.raw(sql);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const rows: Record<string, unknown>[] = result.rows || result || [];
    return mapQueryResults<T>(rows, mapping);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to load ${tableName}: ${errorMsg}`);
    return [];
  }
}

// 각 메타데이터 테이블 로드 함수들
async function loadRelationships(knex: Knex, config: MetadataQueryConfig): Promise<TableRelationship[]> {
  const { sql, mapping } = config.queries.relationships;
  return safeQuery<TableRelationship>(knex, sql, mapping, 'relationships');
}

async function loadNamingConventions(knex: Knex, config: MetadataQueryConfig): Promise<NamingConvention[]> {
  const { sql, mapping } = config.queries.namingConventions;
  return safeQuery<NamingConvention>(knex, sql, mapping, 'naming_conventions');
}

async function loadCodeTables(knex: Knex, config: MetadataQueryConfig): Promise<CodeTable[]> {
  const { sql, mapping } = config.queries.codeTables;
  return safeQuery<CodeTable>(knex, sql, mapping, 'code_tables');
}

async function loadColumnCodeMappings(knex: Knex, config: MetadataQueryConfig): Promise<ColumnCodeMapping[]> {
  const { sql, mapping } = config.queries.columnCodeMappings;
  return safeQuery<ColumnCodeMapping>(knex, sql, mapping, 'column_code_mappings');
}

async function loadCodeAliases(knex: Knex, config: MetadataQueryConfig): Promise<CodeAlias[]> {
  const { sql, mapping } = config.queries.codeAliases;
  return safeQuery<CodeAlias>(knex, sql, mapping, 'code_aliases');
}

async function loadGlossaryTerms(knex: Knex, config: MetadataQueryConfig): Promise<GlossaryTerm[]> {
  const { sql, mapping } = config.queries.glossaryTerms;
  return safeQuery<GlossaryTerm>(knex, sql, mapping, 'glossary_terms');
}

async function loadGlossaryAliases(knex: Knex, config: MetadataQueryConfig): Promise<GlossaryAlias[]> {
  const { sql, mapping } = config.queries.glossaryAliases;
  return safeQuery<GlossaryAlias>(knex, sql, mapping, 'glossary_aliases');
}

async function loadGlossaryContexts(knex: Knex, config: MetadataQueryConfig): Promise<GlossaryContext[]> {
  const { sql, mapping } = config.queries.glossaryContexts;
  return safeQuery<GlossaryContext>(knex, sql, mapping, 'glossary_contexts');
}

async function loadQueryPatterns(knex: Knex, config: MetadataQueryConfig): Promise<QueryPattern[]> {
  const { sql, mapping } = config.queries.queryPatterns;
  return safeQuery<QueryPattern>(knex, sql, mapping, 'query_patterns');
}

async function loadPatternParameters(knex: Knex, config: MetadataQueryConfig): Promise<PatternParameter[]> {
  const { sql, mapping } = config.queries.patternParameters;
  return safeQuery<PatternParameter>(knex, sql, mapping, 'pattern_parameters');
}

async function loadPatternKeywords(knex: Knex, config: MetadataQueryConfig): Promise<PatternKeyword[]> {
  const { sql, mapping } = config.queries.patternKeywords;
  return safeQuery<PatternKeyword>(knex, sql, mapping, 'pattern_keywords');
}

/**
 * 현재 캐시된 메타데이터를 반환합니다.
 *
 * @returns 메타데이터 캐시 또는 null
 *
 * @example
 * const cache = getMetadataCache();
 * if (cache) {
 *   console.log(`Loaded ${cache.relationships.length} relationships`);
 * }
 */
export function getMetadataCache(): MetadataCache | null {
  return cacheInstance;
}

/**
 * 메타데이터 캐시를 새로고침합니다.
 *
 * @param knex - Knex 데이터베이스 연결
 * @param dbType - 데이터베이스 타입
 * @returns 새로 로드된 메타데이터 캐시
 *
 * @example
 * const cache = await refreshMetadataCache(knex, 'postgresql');
 */
export async function refreshMetadataCache(
  knex: Knex,
  dbType: DatabaseType
): Promise<MetadataCache> {
  // 기존 캐시 무효화
  cacheInstance = null;
  logger.info('Metadata cache invalidated, refreshing...');

  return initializeMetadataCache(knex, dbType);
}

/**
 * 메타데이터 캐시를 무효화합니다.
 *
 * @example
 * invalidateMetadataCache();
 */
export function invalidateMetadataCache(): void {
  cacheInstance = null;
  logger.info('Metadata cache invalidated');
}

/**
 * 캐시가 초기화되었는지 확인합니다.
 *
 * @returns 초기화 여부
 */
export function isMetadataCacheInitialized(): boolean {
  return cacheInstance !== null;
}

/**
 * 캐시 통계 정보를 반환합니다.
 */
export function getMetadataCacheStats(): {
  initialized: boolean;
  loadedAt: Date | null;
  databaseType: string | null;
  counts: Record<string, number>;
} {
  if (!cacheInstance) {
    return {
      initialized: false,
      loadedAt: null,
      databaseType: null,
      counts: {},
    };
  }

  return {
    initialized: true,
    loadedAt: cacheInstance.loadedAt,
    databaseType: cacheInstance.databaseType,
    counts: {
      relationships: cacheInstance.relationships.length,
      namingConventions: cacheInstance.namingConventions.length,
      codeTables: cacheInstance.codeTables.length,
      columnCodeMappings: cacheInstance.columnCodeMappings.length,
      codeAliases: cacheInstance.codeAliases.length,
      glossaryTerms: cacheInstance.glossaryTerms.length,
      glossaryAliases: cacheInstance.glossaryAliases.length,
      glossaryContexts: cacheInstance.glossaryContexts.length,
      queryPatterns: cacheInstance.queryPatterns.length,
      patternParameters: cacheInstance.patternParameters.length,
      patternKeywords: cacheInstance.patternKeywords.length,
    },
  };
}
