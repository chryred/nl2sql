-- ============================================================================
-- NL2SQL 메타데이터 테이블: 쿼리 패턴 (Oracle)
-- ============================================================================

ALTER SESSION SET CURRENT_SCHEMA = nl2sql;

-- ============================================================================
-- 1. 쿼리 패턴 정의
-- ============================================================================

CREATE TABLE query_patterns (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pattern_code            VARCHAR2(100) NOT NULL,

    pattern_name            VARCHAR2(200) NOT NULL,
    category                VARCHAR2(50),

    -- Oracle용 템플릿이 기본
    sql_template            CLOB NOT NULL,
    sql_template_pg         CLOB,
    sql_template_mysql      CLOB,

    applicable_tables       CLOB,        -- JSON 형태
    required_columns        CLOB,        -- JSON 형태
    required_joins          CLOB,        -- JSON 형태

    match_score_threshold   NUMBER DEFAULT 70 NOT NULL,
    priority                NUMBER DEFAULT 100 NOT NULL,

    description             CLOB NOT NULL,
    use_case                CLOB,
    example_input           CLOB,
    example_output          CLOB,
    performance_notes       CLOB,

    is_active               NUMBER(1) DEFAULT 1 NOT NULL,
    usage_count             NUMBER DEFAULT 0 NOT NULL,
    last_used_at            TIMESTAMP WITH TIME ZONE,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    created_by              VARCHAR2(100),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_by              VARCHAR2(100),

    CONSTRAINT uk_pattern_code UNIQUE (pattern_code),
    CONSTRAINT chk_pattern_category CHECK (category IS NULL OR category IN (
        'AGGREGATION', 'REPORT', 'LOOKUP', 'ANALYSIS',
        'COMPARISON', 'TREND', 'RANKING', 'GENERAL'
    )),
    CONSTRAINT chk_match_score CHECK (match_score_threshold BETWEEN 0 AND 100),
    CONSTRAINT chk_pattern_active CHECK (is_active IN (0, 1))
);

CREATE INDEX idx_pattern_category ON query_patterns(category);
CREATE INDEX idx_pattern_active ON query_patterns(is_active);
CREATE INDEX idx_pattern_priority ON query_patterns(priority);

-- 코멘트
COMMENT ON TABLE query_patterns IS
    'NL2SQL 메타데이터: 쿼리 패턴 템플릿';


-- ============================================================================
-- 2. 패턴 파라미터
-- ============================================================================

CREATE TABLE pattern_parameters (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pattern_code            VARCHAR2(100) NOT NULL,

    param_name              VARCHAR2(100) NOT NULL,
    param_type              VARCHAR2(30) NOT NULL,

    is_required             NUMBER(1) DEFAULT 1 NOT NULL,
    default_value           CLOB,
    allowed_values          CLOB,        -- JSON 형태
    validation_pattern      VARCHAR2(255),

    infer_from_keywords     CLOB,        -- JSON 형태
    infer_from_column_type  VARCHAR2(50),

    description             CLOB,
    example_value           CLOB,
    display_order           NUMBER DEFAULT 0 NOT NULL,
    is_active               NUMBER(1) DEFAULT 1 NOT NULL,

    CONSTRAINT uk_pattern_param UNIQUE (pattern_code, param_name),
    CONSTRAINT chk_param_type CHECK (param_type IN (
        'COLUMN', 'TABLE', 'VALUE', 'DATE',
        'NUMBER', 'EXPRESSION', 'CONDITION'
    )),
    CONSTRAINT chk_param_required CHECK (is_required IN (0, 1)),
    CONSTRAINT chk_param_active CHECK (is_active IN (0, 1)),
    CONSTRAINT fk_param_pattern
        FOREIGN KEY (pattern_code) REFERENCES query_patterns(pattern_code)
        ON DELETE CASCADE
);

CREATE INDEX idx_pattern_params ON pattern_parameters(pattern_code);

-- 코멘트
COMMENT ON TABLE pattern_parameters IS
    'NL2SQL 메타데이터: 패턴 파라미터';


-- ============================================================================
-- 3. 패턴 키워드
-- ============================================================================

CREATE TABLE pattern_keywords (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pattern_code            VARCHAR2(100) NOT NULL,

    keyword                 VARCHAR2(100) NOT NULL,
    locale                  VARCHAR2(10) DEFAULT 'ko',
    weight                  NUMBER DEFAULT 10 NOT NULL,
    match_type              VARCHAR2(20) DEFAULT 'CONTAINS' NOT NULL,
    is_required             NUMBER(1) DEFAULT 0 NOT NULL,
    is_active               NUMBER(1) DEFAULT 1 NOT NULL,

    CONSTRAINT chk_kw_weight CHECK (weight BETWEEN 1 AND 100),
    CONSTRAINT chk_kw_match_type CHECK (match_type IN (
        'EXACT', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'REGEX'
    )),
    CONSTRAINT chk_kw_required CHECK (is_required IN (0, 1)),
    CONSTRAINT chk_kw_active CHECK (is_active IN (0, 1)),
    CONSTRAINT fk_kw_pattern
        FOREIGN KEY (pattern_code) REFERENCES query_patterns(pattern_code)
        ON DELETE CASCADE
);

CREATE INDEX idx_pattern_kw_lookup ON pattern_keywords(keyword, locale);
CREATE INDEX idx_pattern_kw_pattern ON pattern_keywords(pattern_code);

-- 코멘트
COMMENT ON TABLE pattern_keywords IS
    'NL2SQL 메타데이터: 패턴 매칭 키워드';


-- ============================================================================
-- 트리거
-- ============================================================================
CREATE OR REPLACE TRIGGER trg_query_patterns_update
    BEFORE UPDATE ON query_patterns
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/
