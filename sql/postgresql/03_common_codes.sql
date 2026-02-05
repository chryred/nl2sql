-- ============================================================================
-- NL2SQL 메타데이터 테이블: 공통코드 설정 (PostgreSQL)
-- ============================================================================
--
-- 목적:
--   기존 시스템의 공통코드 테이블 위치와 구조를 정의하고,
--   비즈니스 테이블의 컬럼이 어떤 공통코드 그룹을 사용하는지 매핑합니다.
--
-- PostgreSQL 특화 사항:
--   - TEXT[] 배열 타입으로 다국어 지원
--   - TIMESTAMPTZ로 타임존 인식 시간 저장
--   - ON CONFLICT DO NOTHING으로 멱등성 보장
--
-- 실행 순서:
--   1. 00_create_schema.sql
--   2. 01_relationships.sql (선택)
--   3. 본 스크립트 실행
-- ============================================================================

-- ============================================================================
-- 1. 공통코드 테이블 정의
-- ============================================================================
-- 기존 시스템에 존재하는 공통코드 테이블의 위치와 구조를 정의합니다.
-- 시스템마다 공통코드 테이블 구조가 다르므로 컬럼 매핑 정보를 저장합니다.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.code_tables (
    -- ========================================================================
    -- 기본 식별자
    -- ========================================================================
    id                      SERIAL PRIMARY KEY,
    code_table_name         VARCHAR(100) NOT NULL UNIQUE, -- 논리적 이름 (참조용)
                                                          -- 예: 'main_code', 'legacy_code'

    -- ========================================================================
    -- 실제 공통코드 테이블 위치
    -- ========================================================================
    table_schema            VARCHAR(128) NOT NULL,        -- 스키마명
                                                          -- 예: 'public', 'common'
    table_name              VARCHAR(128) NOT NULL,        -- 테이블명
                                                          -- 예: 'common_code', 'cd_master'

    -- ========================================================================
    -- 코드 테이블 컬럼 매핑
    -- 시스템마다 컬럼명이 다를 수 있으므로 매핑 정보 필요
    -- ========================================================================
    group_code_column       VARCHAR(128) NOT NULL,        -- 그룹코드 컬럼명
                                                          -- 예: 'group_code', 'cd_type'
    code_column             VARCHAR(128) NOT NULL,        -- 코드값 컬럼명
                                                          -- 예: 'code', 'cd_value'
    code_name_column        VARCHAR(128) NOT NULL,        -- 코드명 컬럼명
                                                          -- 예: 'code_name', 'cd_label'
    description_column      VARCHAR(128),                 -- 설명 컬럼명 (선택)
    sort_order_column       VARCHAR(128),                 -- 정렬순서 컬럼명 (선택)

    -- ========================================================================
    -- 필터 조건 (활성 코드만 조회)
    -- ========================================================================
    active_flag_column      VARCHAR(128),                 -- 사용여부 컬럼명
                                                          -- 예: 'is_active', 'use_yn'
    active_flag_value       VARCHAR(50),                  -- 활성 상태 값
                                                          -- 예: 'Y', 'true', '1'
    additional_filter       TEXT,                         -- 추가 WHERE 조건
                                                          -- 예: "deleted_at IS NULL"

    -- ========================================================================
    -- 다국어 지원
    -- ========================================================================
    locale_column           VARCHAR(128),                 -- 언어 컬럼명
    default_locale          VARCHAR(10) DEFAULT 'ko',     -- 기본 언어

    -- ========================================================================
    -- 상태 및 감사
    -- ========================================================================
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    description             TEXT,                         -- 이 설정에 대한 설명
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uk_nl2sql_code_table_loc UNIQUE (table_schema, table_name)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_code_tables_active
    ON nl2sql.code_tables(is_active) WHERE is_active = TRUE;

-- 코멘트
COMMENT ON TABLE nl2sql.code_tables IS
    'NL2SQL 메타데이터: 시스템의 공통코드 테이블 위치 및 구조 정의';
COMMENT ON COLUMN nl2sql.code_tables.code_table_name IS
    '공통코드 테이블의 논리적 이름 (컬럼 매핑 시 참조)';
COMMENT ON COLUMN nl2sql.code_tables.group_code_column IS
    '코드 그룹을 식별하는 컬럼명 (예: group_code, cd_type)';
COMMENT ON COLUMN nl2sql.code_tables.additional_filter IS
    '코드 조회 시 추가할 WHERE 조건문';


-- ============================================================================
-- 2. 컬럼-코드 그룹 매핑
-- ============================================================================
-- 비즈니스 테이블의 특정 컬럼이 어떤 공통코드 그룹을 사용하는지 정의
-- 예: orders.status 컬럼은 'ORD_STATUS' 그룹의 코드를 사용
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.column_code_mapping (
    -- ========================================================================
    -- 기본 식별자
    -- ========================================================================
    id                      SERIAL PRIMARY KEY,

    -- ========================================================================
    -- 비즈니스 테이블.컬럼 정보
    -- ========================================================================
    target_schema           VARCHAR(128) NOT NULL,        -- 비즈니스 테이블 스키마
    target_table            VARCHAR(128) NOT NULL,        -- 비즈니스 테이블명
                                                          -- 예: 'orders', 'customers'
    target_column           VARCHAR(128) NOT NULL,        -- 코드를 사용하는 컬럼명
                                                          -- 예: 'status', 'customer_type'

    -- ========================================================================
    -- 공통코드 참조 정보
    -- ========================================================================
    code_table_name         VARCHAR(100) NOT NULL         -- nl2sql.code_tables 참조
                            REFERENCES nl2sql.code_tables(code_table_name)
                            ON UPDATE CASCADE,
    group_code              VARCHAR(100) NOT NULL,        -- 코드 그룹 식별자
                                                          -- 예: 'ORD_STATUS', 'CUST_TYPE'

    -- ========================================================================
    -- 표시 설정
    -- ========================================================================
    display_name            VARCHAR(200),                 -- 컬럼 표시명 (프롬프트용)
                                                          -- 예: '주문 상태', '고객 유형'
    include_in_prompt       BOOLEAN NOT NULL DEFAULT TRUE,-- 프롬프트에 포함 여부

    -- ========================================================================
    -- 상태 및 감사
    -- ========================================================================
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    description             TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uk_nl2sql_col_code_mapping
        UNIQUE (target_schema, target_table, target_column)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_col_mapping_table
    ON nl2sql.column_code_mapping(target_schema, target_table);
CREATE INDEX IF NOT EXISTS idx_nl2sql_col_mapping_code
    ON nl2sql.column_code_mapping(code_table_name, group_code);

-- 코멘트
COMMENT ON TABLE nl2sql.column_code_mapping IS
    'NL2SQL 메타데이터: 비즈니스 테이블 컬럼과 공통코드 그룹 간 매핑';
COMMENT ON COLUMN nl2sql.column_code_mapping.display_name IS
    'AI 프롬프트에 표시될 컬럼의 비즈니스 명칭';


-- ============================================================================
-- 3. 코드명 별칭 (동의어)
-- ============================================================================
-- 같은 코드를 다양한 표현으로 참조할 수 있도록 별칭 정의
-- 예: '신청', '접수', 'requested' 모두 코드 '01'을 의미
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.code_aliases (
    -- ========================================================================
    -- 기본 식별자
    -- ========================================================================
    id                      SERIAL PRIMARY KEY,

    -- ========================================================================
    -- 코드 식별 정보
    -- ========================================================================
    code_table_name         VARCHAR(100) NOT NULL         -- nl2sql.code_tables 참조
                            REFERENCES nl2sql.code_tables(code_table_name)
                            ON UPDATE CASCADE,
    group_code              VARCHAR(100) NOT NULL,        -- 코드 그룹
    code_value              VARCHAR(100) NOT NULL,        -- 원본 코드값
                                                          -- 예: '01', 'A', 'ACTIVE'

    -- ========================================================================
    -- 별칭 정보
    -- ========================================================================
    alias                   VARCHAR(200) NOT NULL,        -- 별칭 (동의어)
                                                          -- 예: '접수', 'requested'
    locale                  VARCHAR(10) DEFAULT 'ko',     -- 별칭 언어

    -- ========================================================================
    -- 상태
    -- ========================================================================
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 동일 그룹 내 별칭 유일성 (같은 단어가 다른 코드를 의미하면 안됨)
    CONSTRAINT uk_nl2sql_code_alias
        UNIQUE (code_table_name, group_code, alias, locale)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_code_alias_lookup
    ON nl2sql.code_aliases(alias, locale);

-- 코멘트
COMMENT ON TABLE nl2sql.code_aliases IS
    'NL2SQL 메타데이터: 공통코드의 동의어/별칭 정의';


-- ============================================================================
-- 트리거 (updated_at 자동 갱신)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_code_tables_update ON nl2sql.code_tables;
CREATE TRIGGER trg_code_tables_update
    BEFORE UPDATE ON nl2sql.code_tables
    FOR EACH ROW EXECUTE FUNCTION nl2sql.update_timestamp();

DROP TRIGGER IF EXISTS trg_col_mapping_update ON nl2sql.column_code_mapping;
CREATE TRIGGER trg_col_mapping_update
    BEFORE UPDATE ON nl2sql.column_code_mapping
    FOR EACH ROW EXECUTE FUNCTION nl2sql.update_timestamp();
