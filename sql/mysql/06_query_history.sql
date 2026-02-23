-- ============================================================================
-- NL2SQL 메타데이터 테이블: 쿼리 이력 (MySQL)
-- ============================================================================
--
-- 실행:
--   mysql -u user -p dbname < sql/mysql/06_query_history.sql
-- ============================================================================

USE nl2sql;

CREATE TABLE IF NOT EXISTS query_history (
    id              INT AUTO_INCREMENT  PRIMARY KEY,
    query_hash      VARCHAR(64)         NOT NULL UNIQUE  COMMENT 'SHA256 of normalized query',
    natural_query   TEXT                NOT NULL         COMMENT '자연어 질의 원문',
    generated_sql   TEXT                                 COMMENT '생성된 SQL',
    connection_id   VARCHAR(100)                         COMMENT '사용된 DB 연결 ID',
    executed        TINYINT(1)          NOT NULL DEFAULT 0,
    usage_count     INT                 NOT NULL DEFAULT 1  COMMENT '동일 질의 누적 횟수',
    last_used_at    DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_qhist_usage (usage_count),
    INDEX idx_qhist_last  (last_used_at),
    INDEX idx_qhist_conn  (connection_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: nl2sql_query 실행 이력';
