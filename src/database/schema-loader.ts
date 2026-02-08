/**
 * 데이터베이스 스키마 로더
 *
 * @description
 * YAML 파일에 정의된 쿼리를 사용하여 데이터베이스 스키마 정보를 추출합니다.
 * PostgreSQL, MySQL, Oracle 데이터베이스를 지원하며,
 * 각 데이터베이스별 시스템 스키마를 자동으로 제외합니다.
 *
 * @module database/schema-loader
 *
 * @example
 * const loader = new SchemaLoader('postgresql');
 * const schema = await loader.extractSchema(knex);
 * console.log(schema.tables);
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import type { Knex } from 'knex';
import type {
  DatabaseType,
  ExtendedTableInfo,
  ExtendedColumnInfo,
  ConstraintInfo,
  IndexInfo,
  RecentQueryInfo,
  SchemaInfo,
} from './types.js';

/**
 * 쿼리 정의 인터페이스
 *
 * @description
 * YAML 파일에서 로드한 개별 SQL 쿼리의 구조를 정의합니다.
 */
interface QueryDefinition {
  /** SQL 쿼리문 */
  sql: string;
  /** 쿼리 파라미터 목록 */
  params?: string[];
  /** 실패 시 무시할지 여부 (선택적 쿼리) */
  optional?: boolean;
  /** 결과 필드 매핑 */
  mapping?: Record<string, string>;
}

/**
 * 스키마 쿼리 설정 인터페이스
 *
 * @description
 * YAML 파일의 전체 구조를 정의합니다.
 * excludeSchemas와 각종 쿼리 정의를 포함합니다.
 */
interface SchemaQueries {
  /** 제외할 시스템 스키마 목록 */
  excludeSchemas?: string[];
  /** 쿼리 정의 */
  queries: {
    /** 스키마 목록 조회 쿼리 */
    schemas?: QueryDefinition;
    /** 테이블 목록 조회 쿼리 */
    tables: QueryDefinition;
    /** 컬럼 정보 조회 쿼리 */
    columns: QueryDefinition;
    /** 외래키 정보 조회 쿼리 */
    foreignKeys: QueryDefinition;
    /** 제약조건 정보 조회 쿼리 */
    constraints: QueryDefinition;
    /** 인덱스 정보 조회 쿼리 */
    indexes: QueryDefinition;
    /** 최근 쿼리 패턴 조회 쿼리 */
    recentQueries: QueryDefinition;
  };
}

/**
 * 데이터베이스 스키마 정보를 YAML 기반으로 로드하는 클래스
 *
 * @description
 * PostgreSQL, MySQL, Oracle 데이터베이스의 스키마 정보를 추출합니다.
 * YAML 파일에 정의된 쿼리를 사용하여 테이블, 컬럼, 인덱스, 제약조건 등을 조회합니다.
 * 시스템 스키마(pg_catalog, information_schema, SYS 등)는 자동으로 제외됩니다.
 *
 * @example
 * const loader = new SchemaLoader('postgresql');
 * const schema = await loader.extractSchema(knex);
 *
 * // 특정 데이터베이스 지정 (MySQL)
 * const mysqlLoader = new SchemaLoader('mysql');
 * const mysqlSchema = await mysqlLoader.extractSchema(knex, 'mydb');
 */
export class SchemaLoader {
  /** YAML 파일에서 로드한 쿼리 정의 */
  private queries: SchemaQueries;

  /** 데이터베이스 타입 */
  private dbType: DatabaseType;

  /** 제외할 스키마 목록 */
  private excludeSchemas: string[];

  /**
   * SchemaLoader 생성자
   *
   * @param dbType - 데이터베이스 타입 (postgresql, mysql, oracle)
   */
  constructor(dbType: DatabaseType) {
    this.dbType = dbType;
    this.queries = this.loadQueries(dbType);
    this.excludeSchemas = this.queries.excludeSchemas || [];
  }

  /**
   * YAML 파일에서 쿼리 정의를 로드합니다.
   *
   * @param dbType - 데이터베이스 타입
   * @returns 파싱된 스키마 쿼리 설정
   * @throws YAML 파일 로드 실패 시 에러
   * @private
   */
  private loadQueries(dbType: DatabaseType): SchemaQueries {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const schemaPath = join(__dirname, 'schemas', `${dbType}.yaml`);

    try {
      const content = readFileSync(schemaPath, 'utf8');
      return yaml.load(content) as SchemaQueries;
    } catch (error) {
      throw new Error(`Failed to load schema queries for ${dbType}: ${error}`);
    }
  }

  /**
   * 스키마가 시스템 스키마인지 확인합니다.
   *
   * @param schemaName - 확인할 스키마명
   * @returns 시스템 스키마이면 true
   * @private
   */
  private isExcludedSchema(schemaName: string): boolean {
    // Oracle은 대소문자를 구분하므로 대문자로 비교
    if (this.dbType === 'oracle') {
      return this.excludeSchemas.includes(schemaName.toUpperCase());
    }
    // PostgreSQL, MySQL은 소문자로 비교
    return this.excludeSchemas.some(
      (excluded) => excluded.toLowerCase() === schemaName.toLowerCase()
    );
  }

  /**
   * 명명된 파라미터를 위치 기반 파라미터로 치환합니다.
   *
   * @param sql - 원본 SQL 문
   * @param params - 파라미터 이름-값 맵
   * @returns 치환된 SQL과 바인딩 값 배열
   * @private
   */
  private substituteParams(
    sql: string,
    params: Record<string, unknown>
  ): { sql: string; bindings: unknown[] | Record<string, unknown> } {
    if (this.dbType === 'oracle') {
      // Oracle: use named bindings natively
      const bindings: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params)) {
        const regex = new RegExp(`:${key}\\b`);
        if (regex.test(sql)) {
          bindings[key] = value;
        }
      }
      return { sql, bindings };
    }

    // PostgreSQL/MySQL: replace named params with positional ? placeholders
    const bindings: unknown[] = [];
    let processedSql = sql;

    // Collect all :paramName occurrences in SQL appearance order
    const paramRegex = /(?<!:):(\w+)/g;
    let match;
    const orderedOccurrences: string[] = [];

    while ((match = paramRegex.exec(sql)) !== null) {
      const paramName = match[1];
      if (paramName in params) {
        orderedOccurrences.push(paramName);
      }
    }

    // Build bindings in SQL occurrence order
    for (const paramName of orderedOccurrences) {
      bindings.push(params[paramName]);
    }

    // Replace named params with ?
    for (const key of Object.keys(params)) {
      const regex = new RegExp(`(?<!:):${key}\\b`, 'g');
      processedSql = processedSql.replace(regex, '?');
    }

    return { sql: processedSql, bindings };
  }

  /**
   * SQL 쿼리를 실행합니다.
   *
   * @param knex - Knex 데이터베이스 연결 인스턴스
   * @param queryDef - 쿼리 정의
   * @param params - 쿼리 파라미터
   * @returns 쿼리 결과 배열
   * @template T - 결과 레코드 타입
   */
  async executeQuery<T>(
    knex: Knex,
    queryDef: QueryDefinition,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const { sql, bindings } = this.substituteParams(queryDef.sql, params);

    try {
      const result: unknown = await knex.raw(sql, bindings);

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
        const rows: T[] = [];
        const rs = result.resultSet as any;

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
    } catch (error) {
      if (queryDef.optional) {
        return [];
      }
      throw error;
    }
  }

  /**
   * 데이터베이스 스키마 정보를 추출합니다.
   *
   * @description
   * 데이터베이스의 모든 테이블, 컬럼, 인덱스, 제약조건 정보를 추출합니다.
   * 시스템 스키마는 자동으로 제외됩니다.
   *
   * @param knex - Knex 데이터베이스 연결 인스턴스
   * @param database - 대상 데이터베이스명 (MySQL의 경우 필수)
   * @returns 테이블, 컬럼, 인덱스, 제약조건 정보가 포함된 SchemaInfo
   *
   * @example
   * // PostgreSQL - 모든 스키마에서 테이블 조회
   * const schema = await loader.extractSchema(knex);
   *
   * // MySQL - 특정 데이터베이스 지정
   * const schema = await loader.extractSchema(knex, 'mydb');
   */
  async extractSchema(knex: Knex, database?: string): Promise<SchemaInfo> {
    const tables: ExtendedTableInfo[] = [];

    // Get all tables
    const tablesQuery = this.queries.queries.tables;
    const tableParams = database ? { database } : {};
    const tablesResult = await this.executeQuery<Record<string, unknown>>(
      knex,
      tablesQuery,
      tableParams
    );

    for (const tableRow of tablesResult) {
      // 스키마 이름 추출
      const schemaName = (tableRow.schema_name ||
        tableRow.SCHEMA_NAME ||
        tableRow.schemaName ||
        tableRow.OWNER) as string | undefined;

      // 시스템 스키마 제외
      if (schemaName && this.isExcludedSchema(schemaName)) {
        continue;
      }

      const tableName = (tableRow.table_name ||
        tableRow.TABLE_NAME ||
        tableRow.name) as string;
      const tableComment = (tableRow.table_comment ||
        tableRow.TABLE_COMMENT ||
        tableRow.comment) as string | undefined;

      if (!tableName) continue;
      // Get columns - 스키마 이름을 전달
      const columns = await this.getColumns(
        knex,
        tableName,
        database,
        schemaName
      );
      // Get foreign keys and update columns
      const fkMap = await this.getForeignKeys(
        knex,
        tableName,
        database,
        schemaName
      );
      for (const col of columns) {
        const fkInfo = fkMap.get(col.name);
        if (fkInfo) {
          col.isForeignKey = true;
          col.references = fkInfo;
        }
      }

      // Get constraints
      const constraints = await this.getConstraints(
        knex,
        tableName,
        database,
        schemaName
      );

      // Get indexes
      const indexes = await this.getIndexes(
        knex,
        tableName,
        database,
        schemaName
      );

      tables.push({
        schemaName: schemaName || undefined,
        name: tableName,
        comment: tableComment || undefined,
        columns,
        constraints,
        indexes,
      });
    }

    // Get recent queries (optional)
    const recentQueries = await this.getRecentQueries(knex, database);

    return {
      tables,
      recentQueries: recentQueries.length > 0 ? recentQueries : undefined,
    };
  }

  /**
   * 테이블의 컬럼 정보를 조회합니다.
   *
   * @param knex - Knex 연결 인스턴스
   * @param tableName - 테이블명
   * @param database - 데이터베이스명 (MySQL)
   * @param schemaName - 스키마명 (PostgreSQL, Oracle)
   * @returns 컬럼 정보 배열
   * @private
   */
  private async getColumns(
    knex: Knex,
    tableName: string,
    database?: string,
    schemaName?: string
  ): Promise<ExtendedColumnInfo[]> {
    const params: Record<string, unknown> = { tableName };
    if (database) params.database = database;

    // PostgreSQL, Oracle의 경우 스키마 이름 전달
    if (schemaName) {
      params.schemaName =
        this.dbType === 'oracle' ? schemaName.toUpperCase() : schemaName;
    } else if (this.dbType === 'postgresql') {
      params.schemaName = 'public';
    }

    // For Oracle, convert tableName to uppercase
    if (this.dbType === 'oracle') {
      params.tableName = tableName.toUpperCase();
    }
    const result = await this.executeQuery<Record<string, unknown>>(
      knex,
      this.queries.queries.columns,
      params
    );

    return result.map((row) => ({
      name: (row.column_name || row.COLUMN_NAME) as string,
      type: (row.data_type || row.DATA_TYPE) as string,
      nullable: (row.is_nullable || row.IS_NULLABLE) === 'YES',
      defaultValue: (row.column_default ||
        row.COLUMN_DEFAULT ||
        row.DATA_DEFAULT) as string | null,
      isPrimaryKey:
        row.is_primary_key === true ||
        row.is_primary_key === 1 ||
        row.IS_PRIMARY_KEY === 1 ||
        (row.column_key || row.COLUMN_KEY) === 'PRI',
      isForeignKey: false,
      comment: (row.column_comment || row.COLUMN_COMMENT) as string | undefined,
    }));
  }

  /**
   * 테이블의 외래키 정보를 조회합니다.
   *
   * @param knex - Knex 연결 인스턴스
   * @param tableName - 테이블명
   * @param database - 데이터베이스명 (MySQL)
   * @param schemaName - 스키마명 (PostgreSQL, Oracle)
   * @returns 컬럼명을 키로 하는 외래키 참조 정보 맵
   * @private
   */
  private async getForeignKeys(
    knex: Knex,
    tableName: string,
    database?: string,
    schemaName?: string
  ): Promise<Map<string, { schema?: string; table: string; column: string }>> {
    const params: Record<string, unknown> = { tableName };
    if (database) params.database = database;

    if (schemaName) {
      params.schemaName =
        this.dbType === 'oracle' ? schemaName.toUpperCase() : schemaName;
    } else if (this.dbType === 'postgresql') {
      params.schemaName = 'public';
    }

    if (this.dbType === 'oracle') {
      params.tableName = tableName.toUpperCase();
    }

    const result = await this.executeQuery<Record<string, unknown>>(
      knex,
      this.queries.queries.foreignKeys,
      params
    );

    const fkMap = new Map<
      string,
      { schema?: string; table: string; column: string }
    >();
    for (const row of result) {
      const colName = (row.column_name || row.COLUMN_NAME) as string;
      const refSchema = (row.foreign_schema_name || row.FOREIGN_SCHEMA_NAME) as
        | string
        | undefined;
      const refTable = (row.foreign_table_name ||
        row.FOREIGN_TABLE_NAME) as string;
      const refColumn = (row.foreign_column_name ||
        row.FOREIGN_COLUMN_NAME) as string;
      fkMap.set(colName, {
        schema: refSchema,
        table: refTable,
        column: refColumn,
      });
    }

    return fkMap;
  }

  /**
   * 테이블의 제약조건 정보를 조회합니다.
   *
   * @param knex - Knex 연결 인스턴스
   * @param tableName - 테이블명
   * @param database - 데이터베이스명 (MySQL)
   * @param schemaName - 스키마명 (PostgreSQL, Oracle)
   * @returns 제약조건 정보 배열
   * @private
   */
  private async getConstraints(
    knex: Knex,
    tableName: string,
    database?: string,
    schemaName?: string
  ): Promise<ConstraintInfo[]> {
    const params: Record<string, unknown> = { tableName };
    if (database) params.database = database;

    if (schemaName) {
      params.schemaName =
        this.dbType === 'oracle' ? schemaName.toUpperCase() : schemaName;
    } else if (this.dbType === 'postgresql') {
      params.schemaName = 'public';
    }

    if (this.dbType === 'oracle') {
      params.tableName = tableName.toUpperCase();
    }

    const result = await this.executeQuery<Record<string, unknown>>(
      knex,
      this.queries.queries.constraints,
      params
    );

    return result.map((row) => {
      const columnsRaw = row.COLUMNS || row.columns;
      let columns: string[];

      if (Array.isArray(columnsRaw)) {
        columns = columnsRaw as string[];
      } else if (typeof columnsRaw === 'string') {
        columns = columnsRaw.split(',').map((c) => c.trim());
      } else {
        columns = [];
      }

      return {
        name: (row.constraint_name || row.CONSTRAINT_NAME) as string,
        type: (row.constraint_type ||
          row.CONSTRAINT_TYPE) as ConstraintInfo['type'],
        columns,
        definition: (row.definition || row.DEFINITION) as string | undefined,
      };
    });
  }

  /**
   * 테이블의 인덱스 정보를 조회합니다.
   *
   * @param knex - Knex 연결 인스턴스
   * @param tableName - 테이블명
   * @param database - 데이터베이스명 (MySQL)
   * @param schemaName - 스키마명 (PostgreSQL, Oracle)
   * @returns 인덱스 정보 배열
   * @private
   */
  private async getIndexes(
    knex: Knex,
    tableName: string,
    database?: string,
    schemaName?: string
  ): Promise<IndexInfo[]> {
    const params: Record<string, unknown> = { tableName };
    if (database) params.database = database;

    if (schemaName) {
      params.schemaName =
        this.dbType === 'oracle' ? schemaName.toUpperCase() : schemaName;
    } else if (this.dbType === 'postgresql') {
      params.schemaName = 'public';
    }

    if (this.dbType === 'oracle') {
      params.tableName = tableName.toUpperCase();
    }

    const result = await this.executeQuery<Record<string, unknown>>(
      knex,
      this.queries.queries.indexes,
      params
    );

    return result.map((row) => {
      const columnsRaw = row.COLUMNS || row.columns;
      let columns: string[];

      if (Array.isArray(columnsRaw)) {
        columns = columnsRaw as string[];
      } else if (typeof columnsRaw === 'string') {
        columns = columnsRaw.split(',').map((c) => c.trim());
      } else {
        columns = [];
      }

      return {
        name: (row.index_name || row.INDEX_NAME) as string,
        columns,
        unique:
          row.is_unique === true ||
          row.is_unique === 1 ||
          row.is_unique === '1' ||
          row.IS_UNIQUE === 1 ||
          row.IS_UNIQUE === '1',
        type: (row.index_type || row.INDEX_TYPE) as string | undefined,
      };
    });
  }

  /**
   * 최근 실행된 쿼리 패턴을 조회합니다.
   *
   * @description
   * 데이터베이스의 쿼리 통계 정보를 조회합니다.
   * 이 기능은 선택적이며, 필요한 권한이나 확장이 없으면 빈 배열을 반환합니다.
   *
   * @param knex - Knex 연결 인스턴스
   * @param database - 데이터베이스명 (MySQL)
   * @returns 최근 쿼리 정보 배열
   * @private
   */
  private async getRecentQueries(
    knex: Knex,
    database?: string
  ): Promise<RecentQueryInfo[]> {
    const params: Record<string, unknown> = {};
    if (database) params.database = database;

    try {
      const result = await this.executeQuery<Record<string, unknown>>(
        knex,
        this.queries.queries.recentQueries,
        params
      );

      return result.map((row) => ({
        query: (row.query || row.QUERY || row.sql_text) as string,
        callCount: Number(
          row.call_count || row.CALL_COUNT || row.executions || 0
        ),
        avgTimeMs: Number(row.avg_time_ms || row.AVG_TIME_MS || 0),
      }));
    } catch {
      // recentQueries is optional
      return [];
    }
  }

  /**
   * 제외된 스키마 목록을 반환합니다.
   *
   * @returns 제외된 시스템 스키마 목록
   */
  getExcludeSchemas(): string[] {
    return [...this.excludeSchemas];
  }
}
