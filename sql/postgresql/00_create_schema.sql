-- ============================================================================
-- NL2SQL 메타데이터 스키마 생성 (PostgreSQL)
-- ============================================================================
--
-- 목적:
--   NL2SQL 시스템에서 사용하는 메타데이터 테이블들을 별도 스키마로 분리합니다.
--   운영 데이터와 분리하여 관리 편의성을 높이고, 권한 관리를 용이하게 합니다.
--
-- 스키마 구성:
--   nl2sql - NL2SQL 메타데이터 전용 스키마
--
-- 실행 방법:
--   psql -U postgres -d your_database -f 00_create_schema.sql
--
-- 권한 요구사항:
--   - CREATE 권한 (스키마 생성)
--   - 또는 SUPERUSER 권한
--
-- 주의사항:
--   - 이 스크립트는 멱등성(idempotent)을 보장합니다.
--   - 기존 스키마가 있어도 오류 없이 실행됩니다.
--   - 운영 환경에서는 적절한 권한을 가진 계정으로 실행하세요.
-- ============================================================================

-- 스키마 생성 (존재하지 않는 경우에만)
CREATE SCHEMA IF NOT EXISTS nl2sql;

-- 스키마 코멘트
COMMENT ON SCHEMA nl2sql IS
    'NL2SQL 메타데이터 스키마: 테이블 관계, 공통코드, 용어집, 쿼리 패턴 등 저장';

-- 기본 검색 경로에 추가 (선택적)
-- 애플리케이션에서 nl2sql. 접두사 없이 접근하려면 아래 설정 사용
-- ALTER DATABASE your_database SET search_path TO public, nl2sql;

-- 권한 설정 예시 (필요시 주석 해제 후 사용)
-- 읽기 전용 사용자
-- GRANT USAGE ON SCHEMA nl2sql TO nl2sql_reader;
-- GRANT SELECT ON ALL TABLES IN SCHEMA nl2sql TO nl2sql_reader;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA nl2sql GRANT SELECT ON TABLES TO nl2sql_reader;

-- 읽기/쓰기 사용자 (운영자용)
-- GRANT USAGE ON SCHEMA nl2sql TO nl2sql_admin;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA nl2sql TO nl2sql_admin;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA nl2sql TO nl2sql_admin;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA nl2sql GRANT ALL ON TABLES TO nl2sql_admin;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA nl2sql GRANT ALL ON SEQUENCES TO nl2sql_admin;

-- 확인
DO $$
BEGIN
    RAISE NOTICE 'NL2SQL 스키마 생성 완료: nl2sql';
END $$;
