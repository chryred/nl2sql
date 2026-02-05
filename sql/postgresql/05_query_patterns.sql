-- ============================================================================
-- NL2SQL 메타데이터 테이블: 쿼리 패턴 (PostgreSQL)
-- ============================================================================
--
-- 목적:
--   자주 사용되는 SQL 쿼리 패턴을 템플릿으로 정의하여,
--   유사한 자연어 요청 시 검증된 패턴을 기반으로 SQL을 생성합니다.
--
-- 예시:
--   "월별 매출" -> 미리 정의된 월별 집계 패턴 적용
--   "고객별 구매 현황" -> 고객 그룹별 집계 패턴 적용
-- ============================================================================

-- ============================================================================
-- 1. 쿼리 패턴 정의
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.query_patterns (
    -- ========================================================================
    -- 기본 식별자
    -- ========================================================================
    id                      SERIAL PRIMARY KEY,
    pattern_code            VARCHAR(100) NOT NULL UNIQUE, -- 패턴 코드

    -- ========================================================================
    -- 패턴 정보
    -- ========================================================================
    pattern_name            VARCHAR(200) NOT NULL,        -- 패턴 이름
    category                VARCHAR(50)                   -- 패턴 카테고리
                            CHECK (category IS NULL OR category IN (
                                'AGGREGATION',            -- 집계/통계
                                'REPORT',                 -- 리포트
                                'LOOKUP',                 -- 조회
                                'ANALYSIS',               -- 분석
                                'COMPARISON',             -- 비교
                                'TREND',                  -- 추세
                                'RANKING',                -- 순위
                                'GENERAL'                 -- 일반
                            )),

    -- ========================================================================
    -- SQL 템플릿
    -- 플레이스홀더: {{table}}, {{columns}}, {{conditions}}, {{param_name}}
    -- ========================================================================
    sql_template            TEXT NOT NULL,                -- PostgreSQL SQL 템플릿
    sql_template_mysql      TEXT,                         -- MySQL 템플릿
    sql_template_oracle     TEXT,                         -- Oracle 템플릿

    -- ========================================================================
    -- 적용 조건
    -- ========================================================================
    applicable_tables       TEXT[],                       -- 적용 가능 테이블 (NULL=전체)
    required_columns        TEXT[],                       -- 필수 컬럼
    required_joins          TEXT[],                       -- 필수 JOIN 테이블

    -- ========================================================================
    -- 매칭 설정
    -- ========================================================================
    match_score_threshold   INT NOT NULL DEFAULT 70       -- 최소 매칭 점수 (0-100)
                            CHECK (match_score_threshold BETWEEN 0 AND 100),
    priority                INT NOT NULL DEFAULT 100,     -- 우선순위 (낮을수록 높음)

    -- ========================================================================
    -- 문서화
    -- ========================================================================
    description             TEXT NOT NULL,                -- 패턴 설명
    use_case                TEXT,                         -- 사용 사례
    example_input           TEXT,                         -- 입력 예시 (자연어)
    example_output          TEXT,                         -- 출력 예시 (SQL)
    performance_notes       TEXT,                         -- 성능 관련 참고

    -- ========================================================================
    -- 상태 및 통계
    -- ========================================================================
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    usage_count             INT NOT NULL DEFAULT 0,       -- 사용 횟수 (통계)
    last_used_at            TIMESTAMPTZ,                  -- 마지막 사용 시간
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by              VARCHAR(100),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by              VARCHAR(100)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_pattern_category ON nl2sql.query_patterns(category);
CREATE INDEX IF NOT EXISTS idx_nl2sql_pattern_active
    ON nl2sql.query_patterns(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_nl2sql_pattern_priority ON nl2sql.query_patterns(priority);

-- 코멘트
COMMENT ON TABLE nl2sql.query_patterns IS
    'NL2SQL 메타데이터: 자주 사용하는 쿼리 패턴 템플릿';
COMMENT ON COLUMN nl2sql.query_patterns.sql_template IS
    'PostgreSQL SQL 템플릿. {{table}}, {{columns}}, {{conditions}} 등 플레이스홀더 사용';
COMMENT ON COLUMN nl2sql.query_patterns.match_score_threshold IS
    '패턴 적용을 위한 최소 키워드 매칭 점수 (0-100)';


-- ============================================================================
-- 2. 패턴 파라미터 정의
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.pattern_parameters (
    id                      SERIAL PRIMARY KEY,
    pattern_code            VARCHAR(100) NOT NULL
                            REFERENCES nl2sql.query_patterns(pattern_code)
                            ON UPDATE CASCADE ON DELETE CASCADE,

    param_name              VARCHAR(100) NOT NULL,        -- 파라미터 이름
    param_type              VARCHAR(30) NOT NULL          -- 파라미터 타입
                            CHECK (param_type IN (
                                'COLUMN', 'TABLE', 'VALUE',
                                'DATE', 'NUMBER', 'EXPRESSION', 'CONDITION'
                            )),

    is_required             BOOLEAN NOT NULL DEFAULT TRUE,
    default_value           TEXT,                         -- 기본값
    allowed_values          TEXT[],                       -- 허용 값 목록
    validation_pattern      TEXT,                         -- 검증 정규표현식

    infer_from_keywords     TEXT[],                       -- 추론 키워드
    infer_from_column_type  VARCHAR(50),                  -- 추론 컬럼 타입

    description             TEXT,
    example_value           TEXT,
    display_order           INT NOT NULL DEFAULT 0,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT uk_nl2sql_pattern_param UNIQUE (pattern_code, param_name)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_pattern_params ON nl2sql.pattern_parameters(pattern_code);

-- 코멘트
COMMENT ON TABLE nl2sql.pattern_parameters IS
    'NL2SQL 메타데이터: 쿼리 패턴의 파라미터 정의';


-- ============================================================================
-- 3. 패턴 매칭 키워드
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.pattern_keywords (
    id                      SERIAL PRIMARY KEY,
    pattern_code            VARCHAR(100) NOT NULL
                            REFERENCES nl2sql.query_patterns(pattern_code)
                            ON UPDATE CASCADE ON DELETE CASCADE,

    keyword                 VARCHAR(100) NOT NULL,        -- 매칭 키워드
    locale                  VARCHAR(10) DEFAULT 'ko',     -- 언어 코드
    weight                  INT NOT NULL DEFAULT 10       -- 가중치 (1-100)
                            CHECK (weight BETWEEN 1 AND 100),
    match_type              VARCHAR(20) NOT NULL          -- 매칭 방식
                            DEFAULT 'CONTAINS'
                            CHECK (match_type IN (
                                'EXACT', 'CONTAINS', 'STARTS_WITH',
                                'ENDS_WITH', 'REGEX'
                            )),
    is_required             BOOLEAN NOT NULL DEFAULT FALSE,-- 필수 키워드 여부
    is_active               BOOLEAN NOT NULL DEFAULT TRUE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_pattern_kw_lookup
    ON nl2sql.pattern_keywords(keyword, locale);
CREATE INDEX IF NOT EXISTS idx_nl2sql_pattern_kw_pattern
    ON nl2sql.pattern_keywords(pattern_code);

-- 코멘트
COMMENT ON TABLE nl2sql.pattern_keywords IS
    'NL2SQL 메타데이터: 패턴 매칭을 위한 키워드';
COMMENT ON COLUMN nl2sql.pattern_keywords.weight IS
    '키워드 중요도 (1-100). 높을수록 매칭 점수에 큰 영향';
COMMENT ON COLUMN nl2sql.pattern_keywords.is_required IS
    'TRUE면 이 키워드 없으면 패턴 매칭 실패';


-- ============================================================================
-- 트리거
-- ============================================================================
DROP TRIGGER IF EXISTS trg_query_patterns_update ON nl2sql.query_patterns;
CREATE TRIGGER trg_query_patterns_update
    BEFORE UPDATE ON nl2sql.query_patterns
    FOR EACH ROW EXECUTE FUNCTION nl2sql.update_timestamp();
