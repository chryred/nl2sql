-- ============================================================================
-- NL2SQL 메타데이터 테이블: 공통코드 설정 (Oracle)
-- ============================================================================

ALTER SESSION SET CURRENT_SCHEMA = nl2sql;

-- ============================================================================
-- 1. 공통코드 테이블 정의
-- ============================================================================

CREATE TABLE code_tables (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code_table_name         VARCHAR2(100) NOT NULL,

    table_schema            VARCHAR2(128) NOT NULL,
    table_name              VARCHAR2(128) NOT NULL,

    group_code_column       VARCHAR2(128) NOT NULL,
    code_column             VARCHAR2(128) NOT NULL,
    code_name_column        VARCHAR2(128) NOT NULL,
    description_column      VARCHAR2(128),
    sort_order_column       VARCHAR2(128),

    active_flag_column      VARCHAR2(128),
    active_flag_value       VARCHAR2(50),
    additional_filter       CLOB,

    locale_column           VARCHAR2(128),
    default_locale          VARCHAR2(10) DEFAULT 'ko',

    is_active               NUMBER(1) DEFAULT 1 NOT NULL,
    description             CLOB,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT uk_code_table_name UNIQUE (code_table_name),
    CONSTRAINT uk_code_table_loc UNIQUE (table_schema, table_name),
    CONSTRAINT chk_code_active CHECK (is_active IN (0, 1))
);

-- 코멘트
COMMENT ON TABLE code_tables IS
    'NL2SQL 메타데이터: 공통코드 테이블 위치 및 구조';


-- ============================================================================
-- 2. 컬럼-코드 그룹 매핑
-- ============================================================================

CREATE TABLE column_code_mapping (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    target_schema           VARCHAR2(128) NOT NULL,
    target_table            VARCHAR2(128) NOT NULL,
    target_column           VARCHAR2(128) NOT NULL,

    code_table_name         VARCHAR2(100) NOT NULL,
    group_code              VARCHAR2(100) NOT NULL,

    display_name            VARCHAR2(200),
    include_in_prompt       NUMBER(1) DEFAULT 1 NOT NULL,

    is_active               NUMBER(1) DEFAULT 1 NOT NULL,
    description             CLOB,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT uk_col_code_mapping UNIQUE (target_schema, target_table, target_column),
    CONSTRAINT chk_col_mapping_active CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_col_mapping_prompt CHECK (include_in_prompt IN (0, 1)),
    CONSTRAINT fk_col_mapping_code_table
        FOREIGN KEY (code_table_name) REFERENCES code_tables(code_table_name)
        ON DELETE CASCADE
);

CREATE INDEX idx_col_mapping_table ON column_code_mapping(target_schema, target_table);
CREATE INDEX idx_col_mapping_code ON column_code_mapping(code_table_name, group_code);

-- 코멘트
COMMENT ON TABLE column_code_mapping IS
    'NL2SQL 메타데이터: 컬럼-코드그룹 매핑';


-- ============================================================================
-- 3. 코드명 별칭
-- ============================================================================

CREATE TABLE code_aliases (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    code_table_name         VARCHAR2(100) NOT NULL,
    group_code              VARCHAR2(100) NOT NULL,
    code_value              VARCHAR2(100) NOT NULL,

    alias                   VARCHAR2(200) NOT NULL,
    locale                  VARCHAR2(10) DEFAULT 'ko',

    is_active               NUMBER(1) DEFAULT 1 NOT NULL,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT uk_code_alias UNIQUE (code_table_name, group_code, alias, locale),
    CONSTRAINT chk_alias_active CHECK (is_active IN (0, 1)),
    CONSTRAINT fk_alias_code_table
        FOREIGN KEY (code_table_name) REFERENCES code_tables(code_table_name)
        ON DELETE CASCADE
);

CREATE INDEX idx_code_alias_lookup ON code_aliases(alias, locale);

-- 코멘트
COMMENT ON TABLE code_aliases IS
    'NL2SQL 메타데이터: 공통코드 동의어/별칭';


-- ============================================================================
-- 트리거
-- ============================================================================
CREATE OR REPLACE TRIGGER trg_code_tables_update
    BEFORE UPDATE ON code_tables
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_col_mapping_update
    BEFORE UPDATE ON column_code_mapping
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/
