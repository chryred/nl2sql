-- ============================================================================
-- NL2SQL 메타데이터 테이블: 비즈니스 용어집 (PostgreSQL)
-- ============================================================================
--
-- 목적:
--   도메인 특화 비즈니스 용어와 그에 해당하는 SQL 조건을 정의합니다.
--   자연어에서 비즈니스 용어가 사용되면 정의된 SQL 조건으로 자동 변환됩니다.
--
-- 예시:
--   "활성 고객" -> last_purchase_date >= CURRENT_DATE - INTERVAL '3 months'
--   "VIP 고객" -> grade = 'VIP' OR annual_purchase >= 10000000
--   "오늘" -> CURRENT_DATE
-- ============================================================================

-- ============================================================================
-- 1. 비즈니스 용어 정의
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.glossary_terms (
    -- ========================================================================
    -- 기본 식별자
    -- ========================================================================
    id                      SERIAL PRIMARY KEY,
    term_code               VARCHAR(100) NOT NULL UNIQUE, -- 용어 코드
                                                          -- 예: 'ACTIVE_CUSTOMER'

    -- ========================================================================
    -- 용어 정보
    -- ========================================================================
    term                    VARCHAR(200) NOT NULL,        -- 용어 (기본 표현)
                                                          -- 예: '활성 고객', 'VIP 고객'

    category                VARCHAR(50)                   -- 용어 카테고리
                            CHECK (category IS NULL OR category IN (
                                'CUSTOMER',               -- 고객 관련
                                'ORDER',                  -- 주문 관련
                                'PRODUCT',                -- 상품 관련
                                'DATE',                   -- 날짜/기간 관련
                                'STATUS',                 -- 상태 관련
                                'METRIC',                 -- 지표/측정 관련
                                'GENERAL'                 -- 일반
                            )),

    -- ========================================================================
    -- SQL 변환 정보 (PostgreSQL 기본)
    -- ========================================================================
    sql_condition           TEXT NOT NULL,                -- SQL 조건식
                                                          -- 테이블 별칭 없이 컬럼명만 사용

    -- DB별 SQL 조건 (PostgreSQL 제외, 다른 DB용)
    sql_condition_mysql     TEXT,                         -- MySQL 전용
    sql_condition_oracle    TEXT,                         -- Oracle 전용

    -- ========================================================================
    -- 적용 범위
    -- ========================================================================
    apply_to_tables         TEXT[],                       -- 적용 가능 테이블 (NULL=전체)
    required_columns        TEXT[] NOT NULL,              -- 필요 컬럼 목록

    -- ========================================================================
    -- 문서화
    -- ========================================================================
    definition              TEXT NOT NULL,                -- 비즈니스 정의
    example_usage           TEXT,                         -- 사용 예시
    example_sql             TEXT,                         -- 변환 결과 예시
    business_context        TEXT,                         -- 비즈니스 배경

    -- ========================================================================
    -- 우선순위 및 상태
    -- ========================================================================
    priority                INT NOT NULL DEFAULT 100,     -- 우선순위 (낮을수록 먼저)
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by              VARCHAR(100),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by              VARCHAR(100)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_glossary_term ON nl2sql.glossary_terms(term);
CREATE INDEX IF NOT EXISTS idx_nl2sql_glossary_category ON nl2sql.glossary_terms(category);
CREATE INDEX IF NOT EXISTS idx_nl2sql_glossary_active
    ON nl2sql.glossary_terms(is_active) WHERE is_active = TRUE;

-- 코멘트
COMMENT ON TABLE nl2sql.glossary_terms IS
    'NL2SQL 메타데이터: 비즈니스 용어와 SQL 조건 매핑';
COMMENT ON COLUMN nl2sql.glossary_terms.sql_condition IS
    'SQL WHERE 조건. 테이블 별칭 없이 컬럼명만 사용. PostgreSQL 문법 기준';
COMMENT ON COLUMN nl2sql.glossary_terms.required_columns IS
    '이 조건 적용에 필요한 컬럼 목록. 해당 컬럼 없는 테이블에는 적용 불가';


-- ============================================================================
-- 2. 용어 동의어/별칭
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.glossary_aliases (
    id                      SERIAL PRIMARY KEY,
    term_code               VARCHAR(100) NOT NULL
                            REFERENCES nl2sql.glossary_terms(term_code)
                            ON UPDATE CASCADE ON DELETE CASCADE,

    alias                   VARCHAR(200) NOT NULL,        -- 동의어/별칭
    locale                  VARCHAR(10) DEFAULT 'ko',     -- 언어 코드
    match_type              VARCHAR(20) NOT NULL          -- 매칭 방식
                            DEFAULT 'EXACT'
                            CHECK (match_type IN (
                                'EXACT',                  -- 정확히 일치
                                'CONTAINS',               -- 포함
                                'STARTS_WITH',            -- 시작
                                'ENDS_WITH',              -- 끝
                                'REGEX'                   -- 정규표현식
                            )),

    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uk_nl2sql_glossary_alias UNIQUE (term_code, alias, locale)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_glossary_alias_lookup
    ON nl2sql.glossary_aliases(alias, locale);

-- 코멘트
COMMENT ON TABLE nl2sql.glossary_aliases IS
    'NL2SQL 메타데이터: 비즈니스 용어의 동의어/별칭';


-- ============================================================================
-- 3. 용어 컨텍스트 (테이블별 다른 의미)
-- ============================================================================
-- 동일 용어가 테이블마다 다른 의미를 가질 수 있는 경우 정의
-- 예: '활성'이 customers에서는 '최근 구매', products에서는 '판매중'
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.glossary_contexts (
    id                      SERIAL PRIMARY KEY,
    term_code               VARCHAR(100) NOT NULL
                            REFERENCES nl2sql.glossary_terms(term_code)
                            ON UPDATE CASCADE ON DELETE CASCADE,

    context_schema          VARCHAR(128) NOT NULL,
    context_table           VARCHAR(128) NOT NULL,

    sql_condition           TEXT NOT NULL,                -- 이 테이블용 SQL 조건
    sql_condition_mysql     TEXT,
    sql_condition_oracle    TEXT,
    required_columns        TEXT[] NOT NULL,

    context_definition      TEXT,                         -- 이 컨텍스트에서의 의미

    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uk_nl2sql_glossary_context
        UNIQUE (term_code, context_schema, context_table)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_glossary_ctx_table
    ON nl2sql.glossary_contexts(context_schema, context_table);

-- 코멘트
COMMENT ON TABLE nl2sql.glossary_contexts IS
    'NL2SQL 메타데이터: 테이블별로 다른 의미를 가지는 용어의 컨텍스트별 정의';


-- ============================================================================
-- 트리거
-- ============================================================================
DROP TRIGGER IF EXISTS trg_glossary_terms_update ON nl2sql.glossary_terms;
CREATE TRIGGER trg_glossary_terms_update
    BEFORE UPDATE ON nl2sql.glossary_terms
    FOR EACH ROW EXECUTE FUNCTION nl2sql.update_timestamp();
