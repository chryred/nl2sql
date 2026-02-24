/**
 * NL2SQL 엔진 모듈
 *
 * @description
 * 자연어를 SQL로 변환하는 핵심 엔진입니다.
 * 데이터베이스 스키마 추출, AI 프롬프트 생성, SQL 생성 및 실행을
 * 통합적으로 관리합니다.
 *
 * @module core/nl2sql-engine
 *
 * @example
 * import { NL2SQLEngine } from './nl2sql-engine';
 *
 * const engine = new NL2SQLEngine(knex, config);
 * const result = await engine.process('최근 30일간 주문 목록', true);
 * console.log(result.sql);
 * console.log(result.executionResult);
 */

import type { Knex } from 'knex';
import type { Config } from '../config/index.js';
import { createAIClient, type AIProvider } from '../ai/client-factory.js';
import {
  buildPrompt,
  buildTableSelectionPrompt,
  parseSelectedTables,
} from '../ai/prompt-builder.js';
import { parseSQL, validateSQL } from '../ai/response-parser.js';
import {
  extractSchema,
  formatSchemaSummary,
  type SchemaInfo,
  type TableInfo,
} from '../database/schema-extractor.js';
import {
  getMetadataCache,
  initializeMetadataCache,
} from '../database/metadata/index.js';
import type { MetadataCache } from '../database/metadata/types.js';

/** 2-Pass 테이블 선별 임계값. 이 수 이하이면 기존 single-pass 유지 */
const TABLE_COUNT_THRESHOLD = 30;

/**
 * NL2SQL 처리 결과 인터페이스
 *
 * @description
 * 자연어 쿼리 처리 결과를 담는 인터페이스입니다.
 * 생성된 SQL, 사용된 스키마, 선택적으로 실행 결과를 포함합니다.
 */
export interface NL2SQLResult {
  /** 생성된 SQL 쿼리 */
  sql: string;
  /** 쿼리 생성에 사용된 스키마 정보 */
  schema: SchemaInfo;
  /** SQL 실행 결과 (execute 옵션이 true인 경우) */
  executionResult?: unknown[];
}

/**
 * 자연어를 SQL로 변환하는 엔진 클래스
 *
 * @description
 * NL2SQL의 핵심 기능을 제공하는 클래스입니다.
 * - 데이터베이스 스키마 자동 추출 및 캐싱
 * - AI 모델을 통한 SQL 생성
 * - 생성된 SQL 검증 및 실행
 *
 * @example
 * const engine = new NL2SQLEngine(knex, config);
 *
 * // 스키마 확인
 * const schema = await engine.getSchema();
 *
 * // SQL 생성만
 * const sql = await engine.generateSQL('사용자 목록 조회');
 *
 * // SQL 생성 및 실행
 * const result = await engine.process('최근 주문', true);
 */
/**
 * NL2SQLEngine 옵션
 */
export interface NL2SQLEngineOptions {
  /** 메타데이터 캐시 사용 여부 (기본값: true) */
  useMetadata?: boolean;
  /** 주입된 메타데이터 캐시 (ConnectionManager용). undefined=전역싱글톤 사용, null=메타데이터 없음 */
  metadataCache?: MetadataCache | null;
  /** 주입된 스키마 캐시 (ConnectionManager용).
   * undefined=내부 cachedSchema 사용 (CLI 호환),
   * null=항상 재추출,
   * SchemaInfo=주입된 캐시 즉시 반환 (MCP 모드) */
  schemaCache?: SchemaInfo | null;
}

export class NL2SQLEngine {
  /** Knex 데이터베이스 연결 */
  private knex: Knex;

  /** 애플리케이션 설정 */
  private config: Config;

  /** AI 클라이언트 인스턴스 */
  private aiClient: AIProvider;

  /** 캐시된 스키마 정보 */
  private cachedSchema: SchemaInfo | null = null;

  /** 메타데이터 사용 여부 */
  private useMetadata: boolean;

  /** 주입된 메타데이터 캐시 (undefined=전역싱글톤 사용) */
  private injectedCache?: MetadataCache | null;

  /** 주입된 스키마 캐시 (undefined=내부 캐시 경로) */
  private injectedSchemaCache?: SchemaInfo | null;

  /**
   * NL2SQLEngine 생성자
   *
   * @param knex - Knex 데이터베이스 연결 인스턴스
   * @param config - 애플리케이션 설정 객체
   * @param options - 엔진 옵션
   */
  constructor(knex: Knex, config: Config, options: NL2SQLEngineOptions = {}) {
    this.knex = knex;
    this.config = config;
    this.aiClient = createAIClient(config);
    this.useMetadata = options.useMetadata ?? true;
    this.injectedCache = options.metadataCache;
    this.injectedSchemaCache = options.schemaCache;
  }

  /**
   * 데이터베이스 스키마 정보를 가져옵니다.
   *
   * @description
   * 스키마 정보를 캐싱하여 반복 호출 시 성능을 최적화합니다.
   * 캐시를 초기화하려면 clearSchemaCache()를 호출하세요.
   *
   * @returns 스키마 정보 (테이블, 컬럼, 인덱스, 제약조건)
   *
   * @example
   * const schema = await engine.getSchema();
   * console.log(`${schema.tables.length} tables found`);
   */
  async getSchema(): Promise<SchemaInfo> {
    // Guard: `!= null` catches both null and undefined via loose equality.
    // - SchemaInfo value  → injected cache hit, return immediately (MCP mode)
    // - null              → treated as "always re-extract" (falls through to extractSchema)
    // - undefined         → also falls through to internal cachedSchema path (CLI compat)
    //
    // Why `!= null` here instead of `!== undefined` used in getMetadata():
    //   getMetadata() uses `!== undefined` so that an explicit `null` is returned as-is,
    //   meaning "metadata is intentionally absent" (valid return value).
    //   getSchema() uses `!= null` because schema must never be returned as null;
    //   passing `null` signals "skip the cache, always re-extract from DB".
    if (this.injectedSchemaCache != null) {
      return this.injectedSchemaCache;
    }
    // undefined or null: fall through to internal cachedSchema path (CLI compat)
    if (this.cachedSchema) {
      return this.cachedSchema;
    }
    this.cachedSchema = await extractSchema(this.knex, this.config);
    return this.cachedSchema;
  }

  /**
   * 메타데이터 캐시를 가져옵니다.
   *
   * @description
   * 메타데이터 캐시가 초기화되지 않은 경우 자동으로 초기화를 시도합니다.
   * 초기화 실패 시 null을 반환합니다 (graceful degradation).
   *
   * @returns 메타데이터 캐시 또는 null
   *
   * @example
   * const metadata = await engine.getMetadata();
   * if (metadata) {
   *   console.log(`${metadata.glossaryTerms.length} terms loaded`);
   * }
   */
  async getMetadata(): Promise<MetadataCache | null> {
    if (!this.useMetadata) {
      return null;
    }

    // 주입된 캐시가 있으면 사용 (ConnectionManager 경로)
    if (this.injectedCache !== undefined) {
      return this.injectedCache;
    }

    // 전역 싱글톤 경로 (CLI 호환)
    const cached = getMetadataCache();
    if (cached) {
      return cached;
    }

    // 캐시가 없으면 초기화 시도
    try {
      return await initializeMetadataCache(
        this.knex,
        this.config.database.type
      );
    } catch {
      // 메타데이터 로드 실패 시 null 반환 (graceful degradation)
      return null;
    }
  }

  /**
   * 메타데이터 사용 여부를 설정합니다.
   *
   * @param use - 메타데이터 사용 여부
   */
  setUseMetadata(use: boolean): void {
    this.useMetadata = use;
  }

  /**
   * 테이블 목록을 가져옵니다.
   *
   * @description
   * 하위 호환성을 위해 제공되는 메서드입니다.
   * getSchema().tables를 사용하는 것과 동일합니다.
   *
   * @returns 테이블 정보 배열
   * @deprecated getSchema().tables를 대신 사용하세요
   */
  async getTables(): Promise<TableInfo[]> {
    const schema = await this.getSchema();
    return schema.tables;
  }

  /**
   * 자연어 쿼리를 SQL로 변환합니다.
   *
   * @description
   * 1. 데이터베이스 스키마를 추출합니다
   * 2. AI 프롬프트를 구성합니다
   * 3. AI 모델에 쿼리를 요청합니다
   * 4. 응답에서 SQL을 파싱하고 검증합니다
   *
   * @param naturalLanguageQuery - 변환할 자연어 쿼리
   * @returns 생성된 SQL 쿼리 문자열
   * @throws SQL 생성 또는 검증 실패 시 에러
   *
   * @example
   * const sql = await engine.generateSQL('최근 가입한 사용자 10명');
   * // SELECT * FROM users ORDER BY created_at DESC LIMIT 10
   */
  async generateSQL(naturalLanguageQuery: string): Promise<string> {
    const schema = await this.getSchema();
    const metadata = await this.getMetadata();

    let finalSchema: SchemaInfo = schema;
    let finalMetadata: MetadataCache | null = metadata ?? null;

    // 2-Pass: 테이블이 임계값 초과 시 1st Pass로 관련 테이블 선별
    if (schema.tables.length > TABLE_COUNT_THRESHOLD) {
      const tableSummary = formatSchemaSummary(schema);
      const selectionPrompt = buildTableSelectionPrompt(
        tableSummary,
        metadata?.glossaryTerms ?? [],
        metadata?.glossaryAliases ?? [],
        metadata?.relationships ?? [],
        metadata?.queryPatterns ?? [],
        metadata?.patternKeywords ?? [],
        naturalLanguageQuery
      );

      const selectionResponse = await this.aiClient.selectTables(selectionPrompt);
      const selectedTables = parseSelectedTables(selectionResponse);

      if (selectedTables.length > 0) {
        finalSchema = filterSchemaByTables(schema, selectedTables);
        finalMetadata = filterMetadataByTables(metadata ?? null, selectedTables);
      }
      // selectedTables가 비어있으면 전체 스키마로 fallback
    }

    const prompt = buildPrompt({
      tables: finalSchema,
      naturalLanguageQuery,
      dbType: this.config.database.type,
      metadata: finalMetadata,
    });

    const response = await this.aiClient.generateSQL(prompt);
    const sql = parseSQL(response);

    const validation = validateSQL(sql);
    if (!validation.valid) {
      throw new Error(`Generated SQL is invalid: ${validation.error}`);
    }

    return sql;
  }

  /**
   * SQL 쿼리를 실행합니다.
   *
   * @description
   * Knex의 raw 메서드를 사용하여 SQL을 실행합니다.
   * 데이터베이스별로 다른 반환 형식을 통일된 배열로 변환합니다.
   *
   * @param sql - 실행할 SQL 쿼리
   * @returns 쿼리 실행 결과 배열
   *
   * @example
   * const results = await engine.executeSQL('SELECT * FROM users LIMIT 5');
   * console.table(results);
   */
  async executeSQL(sql: string): Promise<unknown[]> {
    const result: any = await this.knex.raw(sql);

    // 1. MySQL 대응
    if (
      Array.isArray(result) &&
      result.length > 0 &&
      Array.isArray(result[0])
    ) {
      return result[0];
    }
    // 2. PostgreSQL 대응
    if (result && typeof result === 'object' && 'rows' in result) {
      return Array.isArray(result.rows) ? result.rows : [];
    }
    // 3. Oracle: 직접 배열 반환 대응
    if (Array.isArray(result)) {
      return result;
    }
    // 4. Oracle: ResultSet(커서) 특수 상황 대응
    if (result && typeof result === 'object' && 'resultSet' in result) {
      const rows: unknown[] = [];
      const rs = result.resultSet;

      try {
        let row;
        // 한 줄씩 읽어서 rows 배열에 담기
        while ((row = await rs.getRow())) {
          rows.push(row);
        }
        return rows;
      } catch (error) {
        console.error('ResultSet 처리 중 오류 발생:', error);
        throw error;
      } finally {
        // [중요] 데이터 추출이 끝나면 반드시 커서를 닫아 리소스 해제
        await rs.close();
      }
    }
    return [];
  }

  /**
   * 자연어 쿼리를 처리합니다 (SQL 생성 및 선택적 실행).
   *
   * @description
   * 전체 NL2SQL 파이프라인을 실행합니다:
   * 1. 스키마 추출
   * 2. SQL 생성
   * 3. (선택적) SQL 실행
   *
   * @param naturalLanguageQuery - 처리할 자연어 쿼리
   * @param execute - SQL 실행 여부 (기본값: false)
   * @returns 처리 결과 (SQL, 스키마, 선택적 실행 결과)
   *
   * @example
   * // SQL 생성만
   * const result1 = await engine.process('사용자 수 조회');
   * console.log(result1.sql);
   *
   * // SQL 생성 및 실행
   * const result2 = await engine.process('사용자 수 조회', true);
   * console.log(result2.executionResult);
   */
  async process(
    naturalLanguageQuery: string,
    execute = false
  ): Promise<NL2SQLResult> {
    const schema = await this.getSchema();
    const sql = await this.generateSQL(naturalLanguageQuery);

    const result: NL2SQLResult = { sql, schema };

    if (execute) {
      result.executionResult = await this.executeSQL(sql);
    }

    return result;
  }


  /**
   * 자연어 쿼리로 연관 테이블의 스키마를 반환합니다.
   *
   * @description
   * LLM을 사용해 자연어 설명과 관련된 테이블을 추정하고,
   * 해당 테이블만 포함된 스키마를 반환합니다.
   * 테이블 선별에 실패하면 전체 스키마를 반환합니다.
   *
   * @param naturalLanguageQuery - 연관 테이블을 추정할 자연어 설명
   * @returns 선별된 테이블의 스키마 (선별 실패 시 전체 스키마)
   */
  async getSchemaByQuery(naturalLanguageQuery: string): Promise<SchemaInfo> {
    const schema = await this.getSchema();
    const metadata = await this.getMetadata();

    const tableSummary = formatSchemaSummary(schema);
    const selectionPrompt = buildTableSelectionPrompt(
      tableSummary,
      metadata?.glossaryTerms ?? [],
      metadata?.glossaryAliases ?? [],
      metadata?.relationships ?? [],
      metadata?.queryPatterns ?? [],
      metadata?.patternKeywords ?? [],
      naturalLanguageQuery
    );

    const selectionResponse = await this.aiClient.selectTables(selectionPrompt);
    const selectedTables = parseSelectedTables(selectionResponse);

    return selectedTables.length > 0
      ? filterSchemaByTables(schema, selectedTables)
      : schema;
  }

  /**
   * 스키마 캐시를 초기화합니다.
   *
   * @description
   * 데이터베이스 스키마가 변경된 경우 캐시를 초기화하여
   * 다음 호출 시 새로운 스키마를 로드하도록 합니다.
   *
   * @example
   * // 테이블 구조 변경 후
   * engine.clearSchemaCache();
   * const freshSchema = await engine.getSchema();
   */
  clearSchemaCache(): void {
    this.cachedSchema = null;
  }
}

/**
 * 선별된 테이블만 스키마에서 필터링
 * @param schema - 전체 스키마
 * @param tableNames - 선별된 테이블명 배열
 * @returns 필터링된 스키마
 */
export function filterSchemaByTables(
  schema: SchemaInfo,
  tableNames: string[]
): SchemaInfo {
  const nameSet = new Set(tableNames.map((n) => n.toLowerCase()));
  return {
    tables: schema.tables.filter((t) => nameSet.has(t.name.toLowerCase())),
    recentQueries: schema.recentQueries,
  };
}

/**
 * 선별된 테이블 관련 메타데이터만 필터링
 * @param metadata - 전체 메타데이터 캐시
 * @param tableNames - 선별된 테이블명 배열
 * @returns 필터링된 메타데이터
 */
export function filterMetadataByTables(
  metadata: MetadataCache | null,
  tableNames: string[]
): MetadataCache | null {
  if (!metadata) return null;

  const nameSet = new Set(tableNames.map((n) => n.toLowerCase()));
  const isRelevantTable = (t: string) => nameSet.has(t.toLowerCase());

  return {
    ...metadata,
    relationships: metadata.relationships.filter(
      (r) => isRelevantTable(r.sourceTable) || isRelevantTable(r.targetTable)
    ),
    glossaryTerms: metadata.glossaryTerms.filter(
      (t) => !t.applyToTables?.length || t.applyToTables.some(isRelevantTable)
    ),
    queryPatterns: metadata.queryPatterns.filter(
      (p) =>
        !p.applicableTables?.length ||
        p.applicableTables.some(isRelevantTable)
    ),
  };
}
