/* ============================================================================
NL2SQL 메타데이터 테이블: 쿼리 이력 (Oracle)
============================================================================

실행:
  sqlplus user/pass@dbname @sql/oracle/06_query_history.sql
============================================================================ */

ALTER SESSION SET CURRENT_SCHEMA = nl2sql;

CREATE TABLE query_history (
    id              NUMBER          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    query_hash      VARCHAR2(64)    NOT NULL,
    natural_query   CLOB            NOT NULL,
    generated_sql   CLOB,
    connection_id   VARCHAR2(100),
    executed        NUMBER(1)       DEFAULT 0 NOT NULL,
    usage_count     NUMBER          DEFAULT 1 NOT NULL,
    last_used_at    TIMESTAMP       DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uk_nl2sql_qhist_hash UNIQUE (query_hash),
    CONSTRAINT chk_qhist_executed   CHECK (executed IN (0, 1))
);

CREATE INDEX idx_nl2sql_qhist_usage ON query_history(usage_count);
CREATE INDEX idx_nl2sql_qhist_last  ON query_history(last_used_at);
CREATE INDEX idx_nl2sql_qhist_conn  ON query_history(connection_id);

COMMENT ON TABLE  nl2sql.query_history IS 'NL2SQL 메타데이터: nl2sql_query 실행 이력';
COMMENT ON COLUMN nl2sql.query_history.query_hash  IS 'SHA256(normalize(natural_query))';
COMMENT ON COLUMN nl2sql.query_history.usage_count IS '동일 자연어 질의 누적 실행 횟수';
