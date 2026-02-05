-- ============================================================================
-- NL2SQL 메타데이터 테이블: 비즈니스 용어집 (MySQL)
-- ============================================================================

USE nl2sql;

-- ============================================================================
-- 1. 비즈니스 용어 정의
-- ============================================================================

CREATE TABLE IF NOT EXISTS glossary_terms (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    term_code               VARCHAR(100) NOT NULL UNIQUE  COMMENT '용어 코드',

    term                    VARCHAR(200) NOT NULL         COMMENT '용어 (기본 표현)',
    category                ENUM('CUSTOMER', 'ORDER', 'PRODUCT', 'DATE',
                                 'STATUS', 'METRIC', 'GENERAL')
                            COMMENT '용어 카테고리',

    -- MySQL용 SQL 조건이 기본
    sql_condition           TEXT NOT NULL                 COMMENT 'SQL 조건식 (MySQL 문법)',
    sql_condition_pg        TEXT                          COMMENT 'PostgreSQL 전용',
    sql_condition_oracle    TEXT                          COMMENT 'Oracle 전용',

    apply_to_tables         JSON                          COMMENT '적용 가능 테이블 (JSON 배열)',
    required_columns        JSON NOT NULL                 COMMENT '필요 컬럼 목록 (JSON 배열)',

    definition              TEXT NOT NULL                 COMMENT '비즈니스 정의',
    example_usage           TEXT                          COMMENT '사용 예시',
    example_sql             TEXT                          COMMENT '변환 결과 예시',
    business_context        TEXT                          COMMENT '비즈니스 배경',

    priority                INT NOT NULL DEFAULT 100      COMMENT '우선순위',
    is_active               TINYINT(1) NOT NULL DEFAULT 1,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by              VARCHAR(100),
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by              VARCHAR(100),

    INDEX idx_glossary_term (term),
    INDEX idx_glossary_category (category),
    INDEX idx_glossary_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 비즈니스 용어와 SQL 조건 매핑';


-- ============================================================================
-- 2. 용어 동의어/별칭
-- ============================================================================

CREATE TABLE IF NOT EXISTS glossary_aliases (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    term_code               VARCHAR(100) NOT NULL,

    alias                   VARCHAR(200) NOT NULL         COMMENT '동의어/별칭',
    locale                  VARCHAR(10) DEFAULT 'ko',
    match_type              ENUM('EXACT', 'CONTAINS', 'STARTS_WITH',
                                 'ENDS_WITH', 'REGEX')
                            NOT NULL DEFAULT 'EXACT',

    is_active               TINYINT(1) NOT NULL DEFAULT 1,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_glossary_alias (term_code, alias, locale),
    INDEX idx_glossary_alias_lookup (alias, locale),

    CONSTRAINT fk_glossary_alias_term
        FOREIGN KEY (term_code) REFERENCES glossary_terms(term_code)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 용어 동의어/별칭';


-- ============================================================================
-- 3. 용어 컨텍스트
-- ============================================================================

CREATE TABLE IF NOT EXISTS glossary_contexts (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    term_code               VARCHAR(100) NOT NULL,

    context_schema          VARCHAR(128) NOT NULL,
    context_table           VARCHAR(128) NOT NULL,

    sql_condition           TEXT NOT NULL,
    sql_condition_pg        TEXT,
    sql_condition_oracle    TEXT,
    required_columns        JSON NOT NULL,

    context_definition      TEXT,

    is_active               TINYINT(1) NOT NULL DEFAULT 1,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uk_glossary_context (term_code, context_schema, context_table),
    INDEX idx_glossary_ctx_table (context_schema, context_table),

    CONSTRAINT fk_glossary_ctx_term
        FOREIGN KEY (term_code) REFERENCES glossary_terms(term_code)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 테이블별 용어 컨텍스트';
