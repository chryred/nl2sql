-- ============================================================================
-- NL2SQL 메타데이터 자동 추출 (MySQL)
-- ============================================================================
--
-- 목적:
--   운영 DB의 시스템 카탈로그에서 메타데이터를 자동 추출하여 nl2sql DB에 적재합니다.
--   FK 제약조건, 코드성 테이블, 컬럼-코드 매핑, 네이밍 패턴 기반 관계를 자동으로 탐지합니다.
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
-- 4단계: 네이밍 컨벤션 기반 관계 추론 → table_relationships
-- ============================================================================
-- naming_conventions 테이블의 패턴을 활용하여 FK 없는 관계를 추론합니다.
-- - confidence_level: MEDIUM (네이밍 패턴 기반)
-- - created_by: 'naming_convention'
-- - is_active: 1 (패턴 기반은 비교적 신뢰도가 높으므로 자동 활성화)
-- - MySQL은 PROCEDURE 사용 (커서 기반 반복)
-- ============================================================================

SELECT '========================================' AS message;
SELECT '4단계: 네이밍 컨벤션 기반 관계 추론' AS message;
SELECT '========================================' AS message;

DROP PROCEDURE IF EXISTS nl2sql_infer_naming_convention;
DELIMITER $$
CREATE PROCEDURE nl2sql_infer_naming_convention()
BEGIN
    DECLARE v_inserted INT DEFAULT 0;
    DECLARE v_skipped INT DEFAULT 0;
    DECLARE v_total INT DEFAULT 0;

    DECLARE v_conv_name VARCHAR(100);
    DECLARE v_col_pattern VARCHAR(255);
    DECLARE v_tbl_pattern VARCHAR(255);
    DECLARE v_col_tgt_pattern VARCHAR(255);
    DECLARE v_prefix_strip VARCHAR(50);
    DECLARE v_suffix_strip VARCHAR(50);
    DECLARE v_pluralize TINYINT;

    DECLARE v_src_schema VARCHAR(128);
    DECLARE v_src_table VARCHAR(128);
    DECLARE v_src_column VARCHAR(128);
    DECLARE v_candidate_table VARCHAR(255);
    DECLARE v_candidate_column VARCHAR(255);
    DECLARE v_actual_table VARCHAR(128);
    DECLARE v_match_group VARCHAR(255);

    DECLARE v_done_conv INT DEFAULT 0;
    DECLARE v_done_col INT DEFAULT 0;

    DECLARE conv_cursor CURSOR FOR
        SELECT convention_name, column_pattern, target_table_pattern,
               target_column_pattern, table_prefix_strip, table_suffix_strip,
               apply_pluralization
        FROM naming_conventions
        WHERE is_active = 1
        ORDER BY priority ASC;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done_conv = 1;

    OPEN conv_cursor;
    conv_loop: LOOP
        FETCH conv_cursor INTO v_conv_name, v_col_pattern, v_tbl_pattern,
            v_col_tgt_pattern, v_prefix_strip, v_suffix_strip, v_pluralize;
        IF v_done_conv THEN LEAVE conv_loop; END IF;

        -- 해당 패턴에 매칭되는 컬럼을 찾아 처리
        BEGIN
            DECLARE col_cursor CURSOR FOR
                SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME,
                       REGEXP_REPLACE(c.COLUMN_NAME, v_col_pattern, '$1') AS match_group
                FROM information_schema.COLUMNS c
                JOIN information_schema.TABLES t
                    ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                WHERE t.TABLE_TYPE = 'BASE TABLE'
                  AND c.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys', 'nl2sql')
                  AND c.COLUMN_NAME REGEXP v_col_pattern;

            DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done_col = 1;

            SET v_done_col = 0;
            OPEN col_cursor;
            col_loop: LOOP
                FETCH col_cursor INTO v_src_schema, v_src_table, v_src_column, v_match_group;
                IF v_done_col THEN LEAVE col_loop; END IF;

                SET v_total = v_total + 1;

                -- 타겟 테이블/컬럼 패턴 치환
                SET v_candidate_table = REPLACE(v_tbl_pattern, '$1', v_match_group);
                SET v_candidate_column = REPLACE(v_col_tgt_pattern, '$1', v_match_group);

                -- 접두사/접미사 제거
                IF v_prefix_strip IS NOT NULL THEN
                    SET v_candidate_table = REGEXP_REPLACE(v_candidate_table,
                        CONCAT('^', v_prefix_strip), '');
                END IF;
                IF v_suffix_strip IS NOT NULL THEN
                    SET v_candidate_table = REGEXP_REPLACE(v_candidate_table,
                        CONCAT(v_suffix_strip, '$'), '');
                END IF;

                -- 테이블 존재 확인 (원래 형태)
                SET v_actual_table = NULL;
                SELECT t.TABLE_NAME INTO v_actual_table
                FROM information_schema.TABLES t
                WHERE t.TABLE_SCHEMA = v_src_schema
                  AND LOWER(t.TABLE_NAME) = LOWER(v_candidate_table)
                  AND t.TABLE_TYPE = 'BASE TABLE'
                LIMIT 1;

                -- 복수형 시도
                IF v_actual_table IS NULL AND v_pluralize = 1 THEN
                    -- +s
                    SELECT t.TABLE_NAME INTO v_actual_table
                    FROM information_schema.TABLES t
                    WHERE t.TABLE_SCHEMA = v_src_schema
                      AND LOWER(t.TABLE_NAME) = LOWER(CONCAT(v_candidate_table, 's'))
                      AND t.TABLE_TYPE = 'BASE TABLE'
                    LIMIT 1;

                    -- +es
                    IF v_actual_table IS NULL THEN
                        SELECT t.TABLE_NAME INTO v_actual_table
                        FROM information_schema.TABLES t
                        WHERE t.TABLE_SCHEMA = v_src_schema
                          AND LOWER(t.TABLE_NAME) = LOWER(CONCAT(v_candidate_table, 'es'))
                          AND t.TABLE_TYPE = 'BASE TABLE'
                        LIMIT 1;
                    END IF;

                    -- y → ies
                    IF v_actual_table IS NULL AND v_candidate_table REGEXP 'y$' THEN
                        SELECT t.TABLE_NAME INTO v_actual_table
                        FROM information_schema.TABLES t
                        WHERE t.TABLE_SCHEMA = v_src_schema
                          AND LOWER(t.TABLE_NAME) = LOWER(
                              CONCAT(LEFT(v_candidate_table, LENGTH(v_candidate_table) - 1), 'ies'))
                          AND t.TABLE_TYPE = 'BASE TABLE'
                        LIMIT 1;
                    END IF;
                END IF;

                IF v_actual_table IS NULL THEN
                    SET v_skipped = v_skipped + 1;
                    ITERATE col_loop;
                END IF;

                -- 타겟 컬럼 존재 확인
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.COLUMNS c2
                    WHERE c2.TABLE_SCHEMA = v_src_schema
                      AND c2.TABLE_NAME = v_actual_table
                      AND LOWER(c2.COLUMN_NAME) = LOWER(v_candidate_column)
                ) THEN
                    SET v_skipped = v_skipped + 1;
                    ITERATE col_loop;
                END IF;

                -- 자기 참조 제외
                IF LOWER(v_src_table) = LOWER(v_actual_table)
                   AND LOWER(v_src_column) = LOWER(v_candidate_column) THEN
                    SET v_skipped = v_skipped + 1;
                    ITERATE col_loop;
                END IF;

                -- INSERT IGNORE (기존 관계가 있으면 건드리지 않음)
                INSERT IGNORE INTO table_relationships (
                    source_schema, source_table, source_column,
                    target_schema, target_table, target_column,
                    relationship_type, confidence_level, join_hint,
                    description, is_active, created_by
                ) VALUES (
                    v_src_schema, v_src_table, v_src_column,
                    v_src_schema, v_actual_table, v_candidate_column,
                    'MANY_TO_ONE', 'MEDIUM', 'LEFT',
                    CONCAT('네이밍 컨벤션 ''', v_conv_name, ''' 기반 추론'),
                    1, 'naming_convention'
                );

                IF ROW_COUNT() > 0 THEN
                    SET v_inserted = v_inserted + 1;
                ELSE
                    SET v_skipped = v_skipped + 1;
                END IF;
            END LOOP col_loop;
            CLOSE col_cursor;
        END;
    END LOOP conv_loop;
    CLOSE conv_cursor;

    SELECT CONCAT('4단계 완료: 총 ', v_total, '건 검토 (신규: ', v_inserted, ', 건너뜀: ', v_skipped, ')') AS message;
END$$
DELIMITER ;

CALL nl2sql_infer_naming_convention();
DROP PROCEDURE IF EXISTS nl2sql_infer_naming_convention;


-- ============================================================================
-- 5단계: 동일 컬럼명 기반 관계 추론 → table_relationships
-- ============================================================================
-- 서로 다른 테이블에 동일한 컬럼명이 존재하고,
-- 한쪽에 PK/UK가 있는 경우 관계를 추론합니다.
-- - confidence_level: LOW
-- - created_by: 'column_match'
-- - is_active: 0 (수동 검토 필요)
-- ============================================================================

SELECT '========================================' AS message;
SELECT '5단계: 동일 컬럼명 기반 관계 추론' AS message;
SELECT '========================================' AS message;

INSERT IGNORE INTO table_relationships (
    source_schema, source_table, source_column,
    target_schema, target_table, target_column,
    relationship_type, confidence_level, join_hint,
    description, is_active, created_by
)
SELECT
    fk_col.TABLE_SCHEMA AS source_schema,
    fk_col.TABLE_NAME   AS source_table,
    fk_col.COLUMN_NAME  AS source_column,
    pk_col.TABLE_SCHEMA AS target_schema,
    pk_col.TABLE_NAME   AS target_table,
    pk_col.COLUMN_NAME  AS target_column,
    'MANY_TO_ONE' AS relationship_type,
    'LOW' AS confidence_level,
    'LEFT' AS join_hint,
    CONCAT('동일 컬럼명 기반 추론: ', fk_col.TABLE_NAME, '.', fk_col.COLUMN_NAME,
           ' → ', pk_col.TABLE_NAME, '.', pk_col.COLUMN_NAME) AS description,
    0 AS is_active,
    'column_match' AS created_by
FROM information_schema.COLUMNS fk_col
JOIN information_schema.COLUMNS pk_col
    ON LOWER(fk_col.COLUMN_NAME) = LOWER(pk_col.COLUMN_NAME)
    AND LOWER(fk_col.DATA_TYPE) = LOWER(pk_col.DATA_TYPE)
    -- 다른 테이블이어야 함
    AND NOT (LOWER(fk_col.TABLE_SCHEMA) = LOWER(pk_col.TABLE_SCHEMA)
             AND LOWER(fk_col.TABLE_NAME) = LOWER(pk_col.TABLE_NAME))
JOIN information_schema.TABLES ft
    ON fk_col.TABLE_SCHEMA = ft.TABLE_SCHEMA
    AND fk_col.TABLE_NAME = ft.TABLE_NAME
    AND ft.TABLE_TYPE = 'BASE TABLE'
JOIN information_schema.TABLES pt
    ON pk_col.TABLE_SCHEMA = pt.TABLE_SCHEMA
    AND pk_col.TABLE_NAME = pt.TABLE_NAME
    AND pt.TABLE_TYPE = 'BASE TABLE'
WHERE
    -- 시스템 스키마 제외
    fk_col.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys', 'nl2sql')
    AND pk_col.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys', 'nl2sql')
    -- PK 측: PK 또는 UNIQUE 인덱스 존재
    AND EXISTS (
        SELECT 1 FROM information_schema.STATISTICS s
        WHERE s.TABLE_SCHEMA = pk_col.TABLE_SCHEMA
          AND s.TABLE_NAME = pk_col.TABLE_NAME
          AND s.COLUMN_NAME = pk_col.COLUMN_NAME
          AND s.NON_UNIQUE = 0
    )
    -- FK 측: PK/UNIQUE 인덱스 없음
    AND NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS s
        WHERE s.TABLE_SCHEMA = fk_col.TABLE_SCHEMA
          AND s.TABLE_NAME = fk_col.TABLE_NAME
          AND s.COLUMN_NAME = fk_col.COLUMN_NAME
          AND s.NON_UNIQUE = 0
    )
    -- 이미 등록된 관계가 아님
    AND NOT EXISTS (
        SELECT 1 FROM table_relationships tr
        WHERE tr.source_schema = fk_col.TABLE_SCHEMA
          AND tr.source_table  = fk_col.TABLE_NAME
          AND tr.source_column = fk_col.COLUMN_NAME
          AND tr.target_schema = pk_col.TABLE_SCHEMA
          AND tr.target_table  = pk_col.TABLE_NAME
          AND tr.target_column = pk_col.COLUMN_NAME
    );

SELECT CONCAT('5단계 완료: ', ROW_COUNT(), '건 동일 컬럼명 관계 추론') AS message;
SELECT '  → SELECT * FROM table_relationships WHERE created_by = ''column_match'' AND is_active = 0' AS message;
SELECT '    으로 검토 후 UPDATE ... SET is_active = 1 로 활성화하세요.' AS message;


-- ============================================================================
-- 결과 요약
-- ============================================================================

SELECT '========================================' AS message;
SELECT '자동 추출 결과 요약' AS message;
SELECT '========================================' AS message;

SELECT 'table_relationships (FK, HIGH)' AS category, COUNT(*) AS cnt
FROM table_relationships WHERE created_by = 'auto_import'
UNION ALL
SELECT 'table_relationships (naming, MEDIUM, 활성)', COUNT(*)
FROM table_relationships WHERE created_by = 'naming_convention'
UNION ALL
SELECT 'table_relationships (colmatch, LOW, 비활성)', COUNT(*)
FROM table_relationships WHERE created_by = 'column_match'
UNION ALL
SELECT 'code_tables (후보, 비활성)', COUNT(*)
FROM code_tables WHERE description LIKE '자동 탐지%'
UNION ALL
SELECT 'column_code_mapping (후보, 비활성)', COUNT(*)
FROM column_code_mapping WHERE description LIKE 'FK→코드테이블%';

SELECT '' AS '';
SELECT '다음 단계:' AS message;
SELECT '  1. SELECT * FROM table_relationships WHERE created_by = ''column_match'' AND is_active = 0;' AS message;
SELECT '     → 동일 컬럼명 추론 관계 검토 후 UPDATE ... SET is_active = 1' AS message;
SELECT '  2. SELECT * FROM code_tables WHERE is_active = 0;' AS message;
SELECT '     → 코드테이블 후보 검토 후 UPDATE ... SET is_active = 1' AS message;
SELECT '  3. SELECT * FROM column_code_mapping WHERE is_active = 0;' AS message;
SELECT '     → group_code 설정 후 UPDATE ... SET is_active = 1' AS message;
