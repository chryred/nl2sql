-- ============================================================================
-- NL2SQL 메타데이터 스키마 생성 (Oracle)
-- ============================================================================
--
-- 목적:
--   NL2SQL 시스템에서 사용하는 메타데이터 테이블들을 별도 스키마(사용자)로 분리합니다.
--   Oracle에서 스키마는 사용자(User)와 동일한 개념입니다.
--
-- 실행 방법:
--   sqlplus / as sysdba @00_create_schema.sql
--   또는 DBA 권한이 있는 계정으로 실행
--
-- 주의사항:
--   - DBA 또는 CREATE USER 권한 필요
--   - 테이블스페이스는 환경에 맞게 수정하세요
--   - Oracle 12c 이상 권장 (Identity Column 지원)
-- ============================================================================

-- 사용자(스키마) 생성
-- Oracle 12c+에서는 C## 접두사가 필요할 수 있음 (CDB 환경)
-- PDB 환경에서는 접두사 불필요

-- 테이블스페이스 설정 (환경에 맞게 수정)
-- CREATE TABLESPACE nl2sql_data
--     DATAFILE '/u01/app/oracle/oradata/nl2sql_data.dbf'
--     SIZE 100M AUTOEXTEND ON MAXSIZE 1G;

-- 사용자 생성
CREATE USER nl2sql IDENTIFIED BY nl2sql_password
    DEFAULT TABLESPACE USERS
    TEMPORARY TABLESPACE TEMP
    QUOTA UNLIMITED ON USERS;

-- 기본 권한 부여
GRANT CREATE SESSION TO nl2sql;
GRANT CREATE TABLE TO nl2sql;
GRANT CREATE SEQUENCE TO nl2sql;
GRANT CREATE TRIGGER TO nl2sql;
GRANT CREATE PROCEDURE TO nl2sql;

-- 권한 설정 예시 (필요시)
-- 읽기 전용 사용자
-- CREATE USER nl2sql_reader IDENTIFIED BY reader_password;
-- GRANT CREATE SESSION TO nl2sql_reader;
-- GRANT SELECT ANY TABLE TO nl2sql_reader;

-- 읽기/쓰기 사용자 (운영자용)
-- CREATE USER nl2sql_admin IDENTIFIED BY admin_password;
-- GRANT CREATE SESSION TO nl2sql_admin;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON nl2sql.table_relationships TO nl2sql_admin;

PROMPT NL2SQL 스키마(사용자) 생성 완료: nl2sql
