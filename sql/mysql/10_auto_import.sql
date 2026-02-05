-- ============================================================================
-- NL2SQL 메타데이터 자동 추출 (MySQL)
-- ============================================================================
--
-- 목적:
--   운영 DB의 시스템 카탈로그에서 메타데이터를 자동 추출하여 nl2sql DB에 적재합니다.
--   FK 제약조건, 코드성 테이블, 컬럼-코드 매핑을 자동으로 탐지합니다.
--
-- 특징:
--   - 멱등성 보장 (ON DUPLICATE KEY UPDATE)
--   - created_by='auto_import' 행만 업데이트 (수동 입력 데이터 보호)
--   - 코드테이블/매핑은 is_active=0으로 삽입 (수동 검토 후 활성화)
--   - 시스템 스키마(mysql, information_schema, performance_schema, sys, nl2sql) 제외
--
-- MySQL 특화 사항:
--   - ON DUPLICATE KEY UPDATE (UPSERT)
--   - information_schema.KEY_COLUMN_USAGE에서 FK 추출
--   - information_schema.TABLES.TABLE_ROWS로 행수 추정
--   - REGEXP로 정규식 매칭
--   - TINYINT(1)로 Boolean 표현
--
-- 실행 순서:
--   1. 00_create_schema.sql
--   2. 01_relationships.sql
--   3. 03_common_codes.sql
--   4. 본 스크립트 실행
--
-- 반복 실행 안전: 예 (UPSERT 사용)
-- ============================================================================

USE nl2sql;

-- 시스템 스키마 목록 (사용자 변수)
SET @excluded_schemas = 'mysql,information_schema,performance_schema,sys,nl2sql';


-- ============================================================================
-- 1단계: FK 제약조건 → table_relationships
-- ============================================================================
-- information_schema.KEY_COLUMN_USAGE에서 FK 정보를 읽어 자동 INSERT합니다.
-- - relationship_type: source 컬럼에 UNIQUE 인덱스가 있으면 ONE_TO_ONE, 없으면 MANY_TO_ONE
-- - confidence_level: FK 존재하므로 항상 HIGH
-- - join_hint: 컬럼이 NOT NULL이면 INNER, nullable이면 LEFT
-- ============================================================================

SELECT '========================================' AS message;
SELECT '1단계: FK 제약조건 → table_relationships' AS message;
SELECT '========================================' AS message;

INSERT INTO table_relationships (
    source_schema, source_table, source_column,
    target_schema, target_table, target_column,
    relationship_type, confidence_level, join_hint,
    description, is_active, created_by
)
SELECT
    kcu.TABLE_SCHEMA    AS source_schema,
    kcu.TABLE_NAME      AS source_table,
    kcu.COLUMN_NAME     AS source_column,
    kcu.REFERENCED_TABLE_SCHEMA AS target_schema,
    kcu.REFERENCED_TABLE_NAME   AS target_table,
    kcu.REFERENCED_COLUMN_NAME  AS target_column,
    -- UNIQUE 인덱스 존재 여부로 관계 유형 결정
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.STATISTICS s
            WHERE s.TABLE_SCHEMA = kcu.TABLE_SCHEMA
              AND s.TABLE_NAME = kcu.TABLE_NAME
              AND s.COLUMN_NAME = kcu.COLUMN_NAME
              AND s.NON_UNIQUE = 0
        ) THEN 'ONE_TO_ONE'
        ELSE 'MANY_TO_ONE'
    END AS relationship_type,
    'HIGH' AS confidence_level,
    -- nullable 여부
    CASE
        WHEN col.IS_NULLABLE = 'NO' THEN 'INNER'
        ELSE 'LEFT'
    END AS join_hint,
    'FK 제약조건에서 자동 추출' AS description,
    1 AS is_active,
    'auto_import' AS created_by
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.COLUMNS col
    ON col.TABLE_SCHEMA = kcu.TABLE_SCHEMA
    AND col.TABLE_NAME = kcu.TABLE_NAME
    AND col.COLUMN_NAME = kcu.COLUMN_NAME
WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL
  -- 시스템 스키마 제외
  AND kcu.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys', 'nl2sql')
  AND kcu.REFERENCED_TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys', 'nl2sql')
ON DUPLICATE KEY UPDATE
    relationship_type = IF(table_relationships.created_by = 'auto_import', VALUES(relationship_type), table_relationships.relationship_type),
    confidence_level  = IF(table_relationships.created_by = 'auto_import', VALUES(confidence_level), table_relationships.confidence_level),
    join_hint         = IF(table_relationships.created_by = 'auto_import', VALUES(join_hint), table_relationships.join_hint),
    description       = IF(table_relationships.created_by = 'auto_import', VALUES(description), table_relationships.description),
    updated_by        = IF(table_relationships.created_by = 'auto_import', 'auto_import', table_relationships.updated_by);

SELECT CONCAT('1단계 완료: ', ROW_COUNT(), '건 처리') AS message;


-- ============================================================================
-- 2단계: 코드 테이블 휴리스틱 탐지 → code_tables
-- ============================================================================
-- 소규모 테이블 중 코드성 테이블을 자동 탐지합니다.
-- is_active=0으로 삽입하여 수동 검토 후 활성화합니다.
--
-- 휴리스틱 점수 기준 (3점 이상이면 후보):
--   - 코드 컬럼 존재 (%code%, %cd%)                    +1
--   - 이름 컬럼 존재 (%name%, %nm%, %label%)            +1
--   - 그룹 컬럼 존재 (%group%, %type%, %category%)      +1
--   - 정렬 컬럼 존재 (%order%, %seq%, %sort%)           +1
--   - 활성 플래그 존재 (%active%, %use%, %yn)           +1
--   - 테이블명에 코드 키워드 포함                         +2
--   - 2개 이상 테이블에서 참조됨                          +2
-- ============================================================================

SELECT '========================================' AS message;
SELECT '2단계: 코드 테이블 휴리스틱 탐지' AS message;
SELECT '========================================' AS message;

INSERT INTO code_tables (
    code_table_name,
    table_schema, table_name,
    group_code_column, code_column, code_name_column,
    sort_order_column, active_flag_column,
    is_active, description
)
SELECT
    CONCAT(t.TABLE_SCHEMA, '.', t.TABLE_NAME) AS code_table_name,
    t.TABLE_SCHEMA AS table_schema,
    t.TABLE_NAME   AS table_name,
    -- 그룹 코드 컬럼 추정 (group > code)
    COALESCE(
        (SELECT c.COLUMN_NAME FROM information_schema.COLUMNS c
         WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
         AND (LOWER(c.COLUMN_NAME) LIKE '%group%' OR LOWER(c.COLUMN_NAME) LIKE '%type%'
              OR LOWER(c.COLUMN_NAME) LIKE '%category%')
         ORDER BY c.ORDINAL_POSITION LIMIT 1),
        (SELECT c.COLUMN_NAME FROM information_schema.COLUMNS c
         WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
         AND (LOWER(c.COLUMN_NAME) LIKE '%code%' OR LOWER(c.COLUMN_NAME) LIKE '%cd%')
         ORDER BY c.ORDINAL_POSITION LIMIT 1),
        'code'
    ) AS group_code_column,
    -- 코드 컬럼 추정
    COALESCE(
        (SELECT c.COLUMN_NAME FROM information_schema.COLUMNS c
         WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
         AND (LOWER(c.COLUMN_NAME) LIKE '%code%' OR LOWER(c.COLUMN_NAME) LIKE '%cd%')
         ORDER BY c.ORDINAL_POSITION LIMIT 1),
        'code'
    ) AS code_column,
    -- 이름 컬럼 추정
    COALESCE(
        (SELECT c.COLUMN_NAME FROM information_schema.COLUMNS c
         WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
         AND (LOWER(c.COLUMN_NAME) LIKE '%name%' OR LOWER(c.COLUMN_NAME) LIKE '%nm%'
              OR LOWER(c.COLUMN_NAME) LIKE '%label%')
         ORDER BY c.ORDINAL_POSITION LIMIT 1),
        'name'
    ) AS code_name_column,
    -- 정렬 컬럼 추정
    (SELECT c.COLUMN_NAME FROM information_schema.COLUMNS c
     WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
     AND (LOWER(c.COLUMN_NAME) LIKE '%order%' OR LOWER(c.COLUMN_NAME) LIKE '%seq%'
          OR LOWER(c.COLUMN_NAME) LIKE '%sort%')
     ORDER BY c.ORDINAL_POSITION LIMIT 1) AS sort_order_column,
    -- 활성 플래그 컬럼 추정
    (SELECT c.COLUMN_NAME FROM information_schema.COLUMNS c
     WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
     AND (LOWER(c.COLUMN_NAME) LIKE '%active%' OR LOWER(c.COLUMN_NAME) LIKE '%use%'
          OR LOWER(c.COLUMN_NAME) LIKE '%\_yn' ESCAPE '\\')
     ORDER BY c.ORDINAL_POSITION LIMIT 1) AS active_flag_column,
    0 AS is_active,  -- 수동 검토 후 활성화
    CONCAT('자동 탐지 (점수: ', total_score, ', 행수: ', TABLE_ROWS, ')') AS description
FROM (
    SELECT
        t.TABLE_SCHEMA,
        t.TABLE_NAME,
        t.TABLE_ROWS,
        -- 휴리스틱 점수 계산
        (
            -- 코드 컬럼 (+1)
            (SELECT IF(COUNT(*) > 0, 1, 0) FROM information_schema.COLUMNS c
             WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
             AND (LOWER(c.COLUMN_NAME) LIKE '%code%' OR LOWER(c.COLUMN_NAME) LIKE '%cd%'))
            +
            -- 이름 컬럼 (+1)
            (SELECT IF(COUNT(*) > 0, 1, 0) FROM information_schema.COLUMNS c
             WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
             AND (LOWER(c.COLUMN_NAME) LIKE '%name%' OR LOWER(c.COLUMN_NAME) LIKE '%nm%'
                  OR LOWER(c.COLUMN_NAME) LIKE '%label%'))
            +
            -- 그룹 컬럼 (+1)
            (SELECT IF(COUNT(*) > 0, 1, 0) FROM information_schema.COLUMNS c
             WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
             AND (LOWER(c.COLUMN_NAME) LIKE '%group%' OR LOWER(c.COLUMN_NAME) LIKE '%type%'
                  OR LOWER(c.COLUMN_NAME) LIKE '%category%'))
            +
            -- 정렬 컬럼 (+1)
            (SELECT IF(COUNT(*) > 0, 1, 0) FROM information_schema.COLUMNS c
             WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
             AND (LOWER(c.COLUMN_NAME) LIKE '%order%' OR LOWER(c.COLUMN_NAME) LIKE '%seq%'
                  OR LOWER(c.COLUMN_NAME) LIKE '%sort%'))
            +
            -- 활성 플래그 (+1)
            (SELECT IF(COUNT(*) > 0, 1, 0) FROM information_schema.COLUMNS c
             WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
             AND (LOWER(c.COLUMN_NAME) LIKE '%active%' OR LOWER(c.COLUMN_NAME) LIKE '%use%'
                  OR LOWER(c.COLUMN_NAME) LIKE '%\_yn' ESCAPE '\\'))
            +
            -- 테이블명 키워드 (+2)
            IF(LOWER(t.TABLE_NAME) REGEXP '(code|cd|common|master|lookup|ref|type|status|category)', 2, 0)
            +
            -- 참조 횟수 (+2)
            IF(COALESCE((
                SELECT COUNT(DISTINCT kcu.TABLE_NAME)
                FROM information_schema.KEY_COLUMN_USAGE kcu
                WHERE kcu.REFERENCED_TABLE_SCHEMA = t.TABLE_SCHEMA
                  AND kcu.REFERENCED_TABLE_NAME = t.TABLE_NAME
                  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
            ), 0) >= 2, 2, 0)
        ) AS total_score
    FROM information_schema.TABLES t
    WHERE t.TABLE_TYPE = 'BASE TABLE'
      AND t.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys', 'nl2sql')
      AND t.TABLE_ROWS BETWEEN 1 AND 1000
) scored
WHERE total_score >= 3
ON DUPLICATE KEY UPDATE
    group_code_column = IF(code_tables.code_table_name = VALUES(code_table_name), VALUES(group_code_column), code_tables.group_code_column),
    code_column       = IF(code_tables.code_table_name = VALUES(code_table_name), VALUES(code_column), code_tables.code_column),
    code_name_column  = IF(code_tables.code_table_name = VALUES(code_table_name), VALUES(code_name_column), code_tables.code_name_column),
    sort_order_column = IF(code_tables.code_table_name = VALUES(code_table_name), VALUES(sort_order_column), code_tables.sort_order_column),
    active_flag_column= IF(code_tables.code_table_name = VALUES(code_table_name), VALUES(active_flag_column), code_tables.active_flag_column),
    description       = IF(code_tables.code_table_name = VALUES(code_table_name), VALUES(description), code_tables.description);

SELECT CONCAT('2단계 완료: ', ROW_COUNT(), '건 코드테이블 후보 탐지') AS message;
SELECT '  → SELECT * FROM nl2sql.code_tables WHERE is_active = 0 으로 검토하세요.' AS message;


-- ============================================================================
-- 3단계: FK → 코드테이블 매핑 → column_code_mapping
-- ============================================================================
-- 1단계(FK)와 2단계(코드테이블) 결과를 조인하여 매핑을 생성합니다.
-- is_active=0, group_code=''로 삽입하여 수동 보완이 필요합니다.
-- ============================================================================

SELECT '========================================' AS message;
SELECT '3단계: FK → 코드테이블 매핑' AS message;
SELECT '========================================' AS message;

INSERT IGNORE INTO column_code_mapping (
    target_schema, target_table, target_column,
    code_table_name, group_code,
    display_name, include_in_prompt,
    is_active, description
)
SELECT
    tr.source_schema,
    tr.source_table,
    tr.source_column,
    ct.code_table_name,
    '',  -- group_code는 수동 보완 필요
    tr.source_column,  -- 컬럼명을 display_name으로 사용
    1,   -- include_in_prompt
    0,   -- 수동 검토 후 활성화
    'FK→코드테이블 자동 매핑 (group_code 수동 설정 필요)'
FROM table_relationships tr
JOIN code_tables ct
    ON tr.target_schema = ct.table_schema
    AND tr.target_table = ct.table_name
WHERE tr.created_by = 'auto_import';

SELECT CONCAT('3단계 완료: ', ROW_COUNT(), '건 매핑 후보 생성') AS message;
SELECT '  → UPDATE nl2sql.column_code_mapping SET group_code = "...", is_active = 1' AS message;
SELECT '    WHERE description LIKE "FK→코드테이블%" 로 보완하세요.' AS message;


-- ============================================================================
-- 결과 요약
-- ============================================================================

SELECT '========================================' AS message;
SELECT '자동 추출 결과 요약' AS message;
SELECT '========================================' AS message;

SELECT 'table_relationships (auto_import)' AS category, COUNT(*) AS cnt
FROM table_relationships WHERE created_by = 'auto_import'
UNION ALL
SELECT 'code_tables (후보, 비활성)', COUNT(*)
FROM code_tables WHERE description LIKE '자동 탐지%'
UNION ALL
SELECT 'column_code_mapping (후보, 비활성)', COUNT(*)
FROM column_code_mapping WHERE description LIKE 'FK→코드테이블%';

SELECT '' AS '';
SELECT '다음 단계:' AS message;
SELECT '  1. SELECT * FROM code_tables WHERE is_active = 0;' AS message;
SELECT '     → 코드테이블 후보 검토 후 UPDATE ... SET is_active = 1' AS message;
SELECT '  2. SELECT * FROM column_code_mapping WHERE is_active = 0;' AS message;
SELECT '     → group_code 설정 후 UPDATE ... SET is_active = 1' AS message;
