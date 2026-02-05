-- ============================================================================
-- NL2SQL 메타데이터 테이블: 공통코드 설정 (MySQL)
-- ============================================================================

USE nl2sql;

-- ============================================================================
-- 1. 공통코드 테이블 정의
-- ============================================================================

CREATE TABLE IF NOT EXISTS code_tables (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    code_table_name         VARCHAR(100) NOT NULL UNIQUE  COMMENT '논리적 이름 (참조용)',

    table_schema            VARCHAR(128) NOT NULL         COMMENT '스키마(데이터베이스)명',
    table_name              VARCHAR(128) NOT NULL         COMMENT '테이블명',

    group_code_column       VARCHAR(128) NOT NULL         COMMENT '그룹코드 컬럼명',
    code_column             VARCHAR(128) NOT NULL         COMMENT '코드값 컬럼명',
    code_name_column        VARCHAR(128) NOT NULL         COMMENT '코드명 컬럼명',
    description_column      VARCHAR(128)                  COMMENT '설명 컬럼명',
    sort_order_column       VARCHAR(128)                  COMMENT '정렬순서 컬럼명',

    active_flag_column      VARCHAR(128)                  COMMENT '사용여부 컬럼명',
    active_flag_value       VARCHAR(50)                   COMMENT '활성 상태 값',
    additional_filter       TEXT                          COMMENT '추가 WHERE 조건',

    locale_column           VARCHAR(128)                  COMMENT '언어 컬럼명',
    default_locale          VARCHAR(10) DEFAULT 'ko'      COMMENT '기본 언어',

    is_active               TINYINT(1) NOT NULL DEFAULT 1,
    description             TEXT,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_code_table_loc (table_schema, table_name),
    INDEX idx_code_tables_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 공통코드 테이블 위치 및 구조';


-- ============================================================================
-- 2. 컬럼-코드 그룹 매핑
-- ============================================================================

CREATE TABLE IF NOT EXISTS column_code_mapping (
    id                      INT AUTO_INCREMENT PRIMARY KEY,

    target_schema           VARCHAR(128) NOT NULL         COMMENT '비즈니스 테이블 스키마',
    target_table            VARCHAR(128) NOT NULL         COMMENT '비즈니스 테이블명',
    target_column           VARCHAR(128) NOT NULL         COMMENT '코드 사용 컬럼명',

    code_table_name         VARCHAR(100) NOT NULL         COMMENT 'code_tables 참조',
    group_code              VARCHAR(100) NOT NULL         COMMENT '코드 그룹 식별자',

    display_name            VARCHAR(200)                  COMMENT '컬럼 표시명 (프롬프트용)',
    include_in_prompt       TINYINT(1) NOT NULL DEFAULT 1 COMMENT '프롬프트 포함 여부',

    is_active               TINYINT(1) NOT NULL DEFAULT 1,
    description             TEXT,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_col_code_mapping (target_schema, target_table, target_column),
    INDEX idx_col_mapping_table (target_schema, target_table),
    INDEX idx_col_mapping_code (code_table_name, group_code),

    CONSTRAINT fk_col_mapping_code_table
        FOREIGN KEY (code_table_name) REFERENCES code_tables(code_table_name)
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 컬럼-코드그룹 매핑';


-- ============================================================================
-- 3. 코드명 별칭
-- ============================================================================

CREATE TABLE IF NOT EXISTS code_aliases (
    id                      INT AUTO_INCREMENT PRIMARY KEY,

    code_table_name         VARCHAR(100) NOT NULL,
    group_code              VARCHAR(100) NOT NULL         COMMENT '코드 그룹',
    code_value              VARCHAR(100) NOT NULL         COMMENT '원본 코드값',

    alias                   VARCHAR(200) NOT NULL         COMMENT '별칭 (동의어)',
    locale                  VARCHAR(10) DEFAULT 'ko'      COMMENT '별칭 언어',

    is_active               TINYINT(1) NOT NULL DEFAULT 1,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_code_alias (code_table_name, group_code, alias, locale),
    INDEX idx_code_alias_lookup (alias, locale),

    CONSTRAINT fk_alias_code_table
        FOREIGN KEY (code_table_name) REFERENCES code_tables(code_table_name)
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 공통코드 동의어/별칭';
