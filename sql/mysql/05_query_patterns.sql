-- ============================================================================
-- NL2SQL 메타데이터 테이블: 쿼리 패턴 (MySQL)
-- ============================================================================

USE nl2sql;

-- ============================================================================
-- 1. 쿼리 패턴 정의
-- ============================================================================

CREATE TABLE IF NOT EXISTS query_patterns (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    pattern_code            VARCHAR(100) NOT NULL UNIQUE  COMMENT '패턴 코드',

    pattern_name            VARCHAR(200) NOT NULL         COMMENT '패턴 이름',
    category                ENUM('AGGREGATION', 'REPORT', 'LOOKUP',
                                 'ANALYSIS', 'COMPARISON', 'TREND',
                                 'RANKING', 'GENERAL')
                            COMMENT '패턴 카테고리',

    -- MySQL용 템플릿이 기본
    sql_template            TEXT NOT NULL                 COMMENT 'MySQL SQL 템플릿',
    sql_template_pg         TEXT                          COMMENT 'PostgreSQL 템플릿',
    sql_template_oracle     TEXT                          COMMENT 'Oracle 템플릿',

    applicable_tables       JSON                          COMMENT '적용 가능 테이블',
    required_columns        JSON                          COMMENT '필수 컬럼',
    required_joins          JSON                          COMMENT '필수 JOIN 테이블',

    match_score_threshold   INT NOT NULL DEFAULT 70       COMMENT '최소 매칭 점수 (0-100)',
    priority                INT NOT NULL DEFAULT 100      COMMENT '우선순위',

    description             TEXT NOT NULL                 COMMENT '패턴 설명',
    use_case                TEXT,
    example_input           TEXT,
    example_output          TEXT,
    performance_notes       TEXT,

    is_active               TINYINT(1) NOT NULL DEFAULT 1,
    usage_count             INT NOT NULL DEFAULT 0        COMMENT '사용 횟수',
    last_used_at            TIMESTAMP NULL,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by              VARCHAR(100),
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by              VARCHAR(100),

    INDEX idx_pattern_category (category),
    INDEX idx_pattern_active (is_active),
    INDEX idx_pattern_priority (priority),

    CONSTRAINT chk_match_score CHECK (match_score_threshold BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 쿼리 패턴 템플릿';


-- ============================================================================
-- 2. 패턴 파라미터
-- ============================================================================

CREATE TABLE IF NOT EXISTS pattern_parameters (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    pattern_code            VARCHAR(100) NOT NULL,

    param_name              VARCHAR(100) NOT NULL         COMMENT '파라미터 이름',
    param_type              ENUM('COLUMN', 'TABLE', 'VALUE',
                                 'DATE', 'NUMBER', 'EXPRESSION', 'CONDITION')
                            NOT NULL,

    is_required             TINYINT(1) NOT NULL DEFAULT 1,
    default_value           TEXT,
    allowed_values          JSON,
    validation_pattern      VARCHAR(255),

    infer_from_keywords     JSON,
    infer_from_column_type  VARCHAR(50),

    description             TEXT,
    example_value           TEXT,
    display_order           INT NOT NULL DEFAULT 0,
    is_active               TINYINT(1) NOT NULL DEFAULT 1,

    UNIQUE KEY uk_pattern_param (pattern_code, param_name),
    INDEX idx_pattern_params (pattern_code),

    CONSTRAINT fk_param_pattern
        FOREIGN KEY (pattern_code) REFERENCES query_patterns(pattern_code)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 패턴 파라미터';


-- ============================================================================
-- 3. 패턴 키워드
-- ============================================================================

CREATE TABLE IF NOT EXISTS pattern_keywords (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    pattern_code            VARCHAR(100) NOT NULL,

    keyword                 VARCHAR(100) NOT NULL         COMMENT '매칭 키워드',
    locale                  VARCHAR(10) DEFAULT 'ko',
    weight                  INT NOT NULL DEFAULT 10       COMMENT '가중치 (1-100)',
    match_type              ENUM('EXACT', 'CONTAINS', 'STARTS_WITH',
                                 'ENDS_WITH', 'REGEX')
                            NOT NULL DEFAULT 'CONTAINS',
    is_required             TINYINT(1) NOT NULL DEFAULT 0,
    is_active               TINYINT(1) NOT NULL DEFAULT 1,

    INDEX idx_pattern_kw_lookup (keyword, locale),
    INDEX idx_pattern_kw_pattern (pattern_code),

    CONSTRAINT chk_weight CHECK (weight BETWEEN 1 AND 100),
    CONSTRAINT fk_kw_pattern
        FOREIGN KEY (pattern_code) REFERENCES query_patterns(pattern_code)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 패턴 매칭 키워드';
