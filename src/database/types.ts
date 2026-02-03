/**
 * NL2SQL 데이터베이스 스키마 타입 정의
 *
 * @description
 * 데이터베이스 스키마 추출 및 SQL 생성에 사용되는 타입들을 정의합니다.
 * PostgreSQL, MySQL, Oracle 데이터베이스를 지원합니다.
 *
 * @module database/types
 */

/**
 * 지원되는 데이터베이스 타입
 *
 * @description
 * NL2SQL에서 지원하는 데이터베이스 종류입니다.
 * - postgresql: PostgreSQL 데이터베이스
 * - mysql: MySQL/MariaDB 데이터베이스
 * - oracle: Oracle 데이터베이스
 */
export type DatabaseType = 'postgresql' | 'mysql' | 'oracle';

/**
 * 컬럼 정보 인터페이스
 *
 * @description
 * 테이블의 개별 컬럼에 대한 상세 정보를 담는 인터페이스입니다.
 * 기본키, 외래키, NULL 허용 여부 등 컬럼의 모든 메타데이터를 포함합니다.
 *
 * @example
 * const column: ExtendedColumnInfo = {
 *   name: 'user_id',
 *   type: 'integer',
 *   nullable: false,
 *   defaultValue: null,
 *   isPrimaryKey: true,
 *   isForeignKey: false,
 *   comment: '사용자 고유 식별자'
 * };
 */
export interface ExtendedColumnInfo {
  /** 컬럼명 */
  name: string;

  /** 데이터 타입 (예: varchar, integer, timestamp) */
  type: string;

  /** NULL 값 허용 여부 */
  nullable: boolean;

  /** 기본값 (없으면 null) */
  defaultValue: string | null;

  /** 기본키 여부 */
  isPrimaryKey: boolean;

  /** 외래키 여부 */
  isForeignKey: boolean;

  /**
   * 외래키 참조 정보
   * @description 이 컬럼이 외래키인 경우, 참조하는 테이블과 컬럼 정보
   */
  references?: {
    /** 참조하는 스키마명 (다른 스키마 참조 시) */
    schema?: string;
    /** 참조하는 테이블명 */
    table: string;
    /** 참조하는 컬럼명 */
    column: string;
  };

  /** 컬럼 설명 (코멘트) */
  comment?: string;
}

/**
 * 제약조건 정보 인터페이스
 *
 * @description
 * 테이블의 제약조건(Constraint) 정보를 담는 인터페이스입니다.
 * PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK 제약조건을 지원합니다.
 *
 * @example
 * const constraint: ConstraintInfo = {
 *   name: 'pk_users',
 *   type: 'PRIMARY KEY',
 *   columns: ['user_id']
 * };
 */
export interface ConstraintInfo {
  /** 제약조건 이름 */
  name: string;

  /** 제약조건 타입 */
  type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK';

  /** 제약조건에 포함된 컬럼 목록 */
  columns: string[];

  /** 제약조건 정의 (CHECK 제약조건의 경우 조건식) */
  definition?: string;
}

/**
 * 인덱스 정보 인터페이스
 *
 * @description
 * 테이블의 인덱스 정보를 담는 인터페이스입니다.
 * 인덱스명, 컬럼 목록, 유니크 여부 등을 포함합니다.
 *
 * @example
 * const index: IndexInfo = {
 *   name: 'idx_users_email',
 *   columns: ['email'],
 *   unique: true,
 *   type: 'btree'
 * };
 */
export interface IndexInfo {
  /** 인덱스 이름 */
  name: string;

  /** 인덱스에 포함된 컬럼 목록 */
  columns: string[];

  /** 유니크 인덱스 여부 */
  unique: boolean;

  /** 인덱스 타입 (예: btree, hash, gin, gist) */
  type?: string;
}

/**
 * 최근 쿼리 정보 인터페이스
 *
 * @description
 * 데이터베이스에서 실행된 최근 쿼리 패턴 정보를 담는 인터페이스입니다.
 * 쿼리 성능 최적화 힌트를 제공하는 데 활용됩니다.
 *
 * @example
 * const recentQuery: RecentQueryInfo = {
 *   query: 'SELECT * FROM users WHERE status = ?',
 *   callCount: 1500,
 *   avgTimeMs: 2.5
 * };
 */
export interface RecentQueryInfo {
  /** SQL 쿼리문 */
  query: string;

  /** 실행 횟수 */
  callCount: number;

  /** 평균 실행 시간 (밀리초) */
  avgTimeMs: number;
}

/**
 * 테이블 정보 인터페이스
 *
 * @description
 * 데이터베이스 테이블의 전체 정보를 담는 인터페이스입니다.
 * 테이블명, 스키마명, 컬럼, 제약조건, 인덱스 등 모든 메타데이터를 포함합니다.
 *
 * @example
 * const table: ExtendedTableInfo = {
 *   schemaName: 'public',
 *   name: 'users',
 *   comment: '사용자 정보 테이블',
 *   columns: [...],
 *   constraints: [...],
 *   indexes: [...]
 * };
 */
export interface ExtendedTableInfo {
  /**
   * 스키마(데이터베이스) 이름
   * @description PostgreSQL: schema, MySQL: database, Oracle: owner
   */
  schemaName?: string;

  /** 테이블명 */
  name: string;

  /** 테이블 설명 (코멘트) */
  comment?: string;

  /** 컬럼 목록 */
  columns: ExtendedColumnInfo[];

  /** 제약조건 목록 */
  constraints: ConstraintInfo[];

  /** 인덱스 목록 */
  indexes: IndexInfo[];
}

/**
 * 스키마 전체 정보 인터페이스
 *
 * @description
 * 데이터베이스의 전체 스키마 정보를 담는 인터페이스입니다.
 * 모든 테이블 정보와 선택적으로 최근 쿼리 패턴을 포함합니다.
 *
 * @example
 * const schema: SchemaInfo = {
 *   tables: [userTable, orderTable, productTable],
 *   recentQueries: [...]
 * };
 */
export interface SchemaInfo {
  /** 테이블 목록 */
  tables: ExtendedTableInfo[];

  /** 최근 실행된 쿼리 패턴 (선택적, 권한 필요) */
  recentQueries?: RecentQueryInfo[];
}

/**
 * 컬럼 정보 타입 별칭 (하위 호환성)
 * @deprecated ExtendedColumnInfo를 대신 사용하세요
 */
export type ColumnInfo = ExtendedColumnInfo;

/**
 * 테이블 정보 타입 별칭 (하위 호환성)
 * @deprecated ExtendedTableInfo를 대신 사용하세요
 */
export type TableInfo = ExtendedTableInfo;
