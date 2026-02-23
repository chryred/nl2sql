-- ============================================================================
-- NL2SQL 메타데이터 테이블: 쿼리 이력 (PostgreSQL)
-- ============================================================================
--
-- 목적:
--   nl2sql_query 실행 이력을 자동으로 기록합니다.
--   동일 질의는 usage_count를 누적하여 자주 사용하는 쿼리를 추적합니다.
--   query_history_register로 query_patterns에 승격(북마크화)할 수 있습니다.
--
-- 실행:
--   psql -U user -d dbname -f sql/postgresql/06_query_history.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.query_history (
    id              SERIAL          PRIMARY KEY,
    query_hash      VARCHAR(64)     NOT NULL UNIQUE, -- SHA256(normalize(natural_query))
    natural_query   TEXT            NOT NULL,         -- 자연어 질의 원문
    generated_sql   TEXT,                             -- 생성된 SQL
    connection_id   VARCHAR(100),                     -- 사용된 DB 연결 ID
    executed        BOOLEAN         NOT NULL DEFAULT FALSE,
    usage_count     INT             NOT NULL DEFAULT 1,   -- 동일 질의 누적 횟수
    last_used_at    TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_qhist_usage ON nl2sql.query_history(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_nl2sql_qhist_last  ON nl2sql.query_history(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_nl2sql_qhist_conn  ON nl2sql.query_history(connection_id);

-- 코멘트
COMMENT ON TABLE  nl2sql.query_history IS 'NL2SQL 메타데이터: nl2sql_query 실행 이력';
COMMENT ON COLUMN nl2sql.query_history.query_hash   IS 'SHA256(normalize(natural_query)) - 중복 질의 식별자';
COMMENT ON COLUMN nl2sql.query_history.usage_count  IS '동일 자연어 질의 누적 실행 횟수';
COMMENT ON COLUMN nl2sql.query_history.last_used_at IS '가장 최근 실행 시각 (UPSERT 시 갱신)';
