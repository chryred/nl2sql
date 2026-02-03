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
import { buildPrompt } from '../ai/prompt-builder.js';
import { parseSQL, validateSQL } from '../ai/response-parser.js';
import { extractSchema, type SchemaInfo, type TableInfo } from '../database/schema-extractor.js';

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
export class NL2SQLEngine {
  /** Knex 데이터베이스 연결 */
  private knex: Knex;

  /** 애플리케이션 설정 */
  private config: Config;

  /** AI 클라이언트 인스턴스 */
  private aiClient: AIProvider;

  /** 캐시된 스키마 정보 */
  private cachedSchema: SchemaInfo | null = null;

  /**
   * NL2SQLEngine 생성자
   *
   * @param knex - Knex 데이터베이스 연결 인스턴스
   * @param config - 애플리케이션 설정 객체
   */
  constructor(knex: Knex, config: Config) {
    this.knex = knex;
    this.config = config;
    this.aiClient = createAIClient(config);
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
    if (this.cachedSchema) {
      return this.cachedSchema;
    }
    this.cachedSchema = await extractSchema(this.knex, this.config);
    return this.cachedSchema;
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

    const prompt = buildPrompt({
      tables: schema,
      naturalLanguageQuery,
      dbType: this.config.database.type,
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
    const result: unknown = await this.knex.raw(sql);

    // Handle different database return formats
    if (Array.isArray(result)) {
      // MySQL returns [rows, fields]
      const rows = result[0];
      return Array.isArray(rows) ? rows : [];
    }
    // PostgreSQL returns { rows: [...] }
    if (typeof result === 'object' && result !== null && 'rows' in result) {
      const { rows } = result as { rows: unknown[] };
      return Array.isArray(rows) ? rows : [];
    }
    // Oracle may return array directly
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
  async process(naturalLanguageQuery: string, execute = false): Promise<NL2SQLResult> {
    const schema = await this.getSchema();
    const sql = await this.generateSQL(naturalLanguageQuery);

    const result: NL2SQLResult = { sql, schema };

    if (execute) {
      result.executionResult = await this.executeSQL(sql);
    }

    return result;
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
