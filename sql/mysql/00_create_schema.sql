-- ============================================================================
-- NL2SQL 메타데이터 스키마 생성 (MySQL)
-- ============================================================================
--
-- 목적:
--   NL2SQL 시스템에서 사용하는 메타데이터 테이블들을 별도 데이터베이스로 분리합니다.
--   MySQL에서는 스키마와 데이터베이스가 동의어입니다.
--
-- 실행 방법:
--   mysql -u root -p < 00_create_schema.sql
--
-- 주의사항:
--   - MySQL 8.0 이상 권장 (CHECK 제약조건 지원)
--   - utf8mb4 문자셋 사용 (한글 및 이모지 지원)
-- ============================================================================

-- 데이터베이스(스키마) 생성
CREATE DATABASE IF NOT EXISTS nl2sql
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

-- 권한 설정 예시 (필요시 주석 해제)
-- 읽기 전용 사용자
-- CREATE USER IF NOT EXISTS 'nl2sql_reader'@'%' IDENTIFIED BY 'password';
-- GRANT SELECT ON nl2sql.* TO 'nl2sql_reader'@'%';

-- 읽기/쓰기 사용자 (운영자용)
-- CREATE USER IF NOT EXISTS 'nl2sql_admin'@'%' IDENTIFIED BY 'password';
-- GRANT ALL PRIVILEGES ON nl2sql.* TO 'nl2sql_admin'@'%';

-- FLUSH PRIVILEGES;

SELECT 'NL2SQL 데이터베이스 생성 완료: nl2sql' AS message;
