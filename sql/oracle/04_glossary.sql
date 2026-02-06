/* ============================================================================
NL2SQL 메타데이터 테이블: 비즈니스 용어집 (Oracle)
============================================================================ */

/* 스키마 변경 */
ALTER SESSION SET CURRENT_SCHEMA = nl2sql;
ALTER SESSION SET CONTAINER = AMUS;

/* 1. 비즈니스 용어 정의 */
CREATE TABLE glossary_terms (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    term_code               VARCHAR2(100) NOT NULL,
    term                    VARCHAR2(200) NOT NULL,
    category                VARCHAR2(50),
    /* Oracle용 SQL 조건이 기본 */
    sql_condition           CLOB NOT NULL,
    sql_condition_pg        CLOB,
    sql_condition_mysql     CLOB,
    apply_to_tables         CLOB,        /* JSON 형태 */
    required_columns        CLOB NOT NULL, /* JSON 형태 */
    definition              CLOB NOT NULL,
    example_usage           CLOB,
    example_sql             CLOB,
    business_context        CLOB,
    priority                NUMBER DEFAULT 100 NOT NULL,
    is_active               NUMBER(1) DEFAULT 1 NOT NULL,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    created_by              VARCHAR2(100),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_by              VARCHAR2(100),
    CONSTRAINT uk_glossary_term_code UNIQUE (term_code),
    CONSTRAINT chk_glossary_category CHECK (category IS NULL OR category IN (
        'CUSTOMER', 'ORDER', 'PRODUCT', 'DATE',
        'STATUS', 'METRIC', 'GENERAL'
    )),
    CONSTRAINT chk_glossary_active CHECK (is_active IN (0, 1))
);

/* 인덱스 생성 */
CREATE INDEX idx_glossary_term ON glossary_terms(term);
CREATE INDEX idx_glossary_category ON glossary_terms(category);
CREATE INDEX idx_glossary_active ON glossary_terms(is_active);

/* 테이블 코멘트 */
COMMENT ON TABLE glossary_terms IS 'NL2SQL 메타데이터: 비즈니스 용어와 SQL 조건 매핑';

/* 2. 용어 동의어/별칭 */
CREATE TABLE glossary_aliases (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    term_code               VARCHAR2(100) NOT NULL,
    alias                   VARCHAR2(200) NOT NULL,
    locale                  VARCHAR2(10) DEFAULT 'ko',
    match_type              VARCHAR2(20) DEFAULT 'EXACT' NOT NULL,
    is_active               NUMBER(1) DEFAULT 1 NOT NULL,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT uk_glossary_alias UNIQUE (term_code, alias, locale),
    CONSTRAINT chk_alias_match_type CHECK (match_type IN (
        'EXACT', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'REGEX'
    )),
    CONSTRAINT chk_g_alias_active CHECK (is_active IN (0, 1)),
    CONSTRAINT fk_glossary_alias_term
        FOREIGN KEY (term_code) REFERENCES glossary_terms(term_code)
        ON DELETE CASCADE
);

CREATE INDEX idx_glossary_alias_lookup ON glossary_aliases(alias, locale);
COMMENT ON TABLE glossary_aliases IS 'NL2SQL 메타데이터: 용어 동의어/별칭';

/* 3. 용어 컨텍스트 (테이블별 특화 조건) */
CREATE TABLE glossary_contexts (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    term_code               VARCHAR2(100) NOT NULL,
    context_schema          VARCHAR2(128) NOT NULL,
    context_table           VARCHAR2(128) NOT NULL,
    sql_condition           CLOB NOT NULL,
    sql_condition_pg        CLOB,
    sql_condition_mysql     CLOB,
    required_columns        CLOB NOT NULL,
    context_definition      CLOB,
    is_active               NUMBER(1) DEFAULT 1 NOT NULL,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT uk_glossary_context UNIQUE (term_code, context_schema, context_table),
    CONSTRAINT chk_g_ctx_active CHECK (is_active IN (0, 1)),
    CONSTRAINT fk_glossary_ctx_term
        FOREIGN KEY (term_code) REFERENCES glossary_terms(term_code)
        ON DELETE CASCADE
);

CREATE INDEX idx_glossary_ctx_table ON glossary_contexts(context_schema, context_table);
COMMENT ON TABLE glossary_contexts IS 'NL2SQL 메타데이터: 테이블별 용어 컨텍스트';

/* 트리거: updated_at 자동 갱신 */
CREATE OR REPLACE TRIGGER trg_glossary_terms_update
    BEFORE UPDATE ON glossary_terms
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/