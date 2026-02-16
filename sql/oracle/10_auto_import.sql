/*
-- ============================================================================
-- NL2SQL 메타데이터 자동 추출 (Oracle)
-- ============================================================================
--
-- 목적:
--   운영 DB의 시스템 카탈로그에서 메타데이터를 자동 추출하여 nl2sql 스키마에 적재합니다.
--   FK 제약조건, 코드성 테이블, 컬럼-코드 매핑, 네이밍 패턴 기반 관계를 자동으로 탐지합니다.
--
-- 특징:
--   - 멱등성 보장 (MERGE INTO ... USING)
--   - created_by='auto_import' 행만 업데이트 (수동 입력 데이터 보호)
--   - 코드테이블/매핑은 is_active=0으로 삽입 (수동 검토 후 활성화)
--   - 시스템 스키마(SYS, SYSTEM, DBSNMP, OUTLN 등) 및 nl2sql 스키마 제외
--
-- Oracle 특화 사항:
--   - MERGE INTO ... USING (UPSERT)
--   - ALL_CONSTRAINTS / ALL_CONS_COLUMNS에서 FK 추출
--   - ALL_TABLES.NUM_ROWS로 행수 추정
--   - REGEXP_LIKE()로 정규식 매칭
--   - NUMBER(1)로 Boolean 표현
--   - DBMS_OUTPUT.PUT_LINE으로 메시지 출력
--
-- 실행 순서:
--   1. 00_create_schema.sql
--   2. 01_relationships.sql
--   3. 03_common_codes.sql
--   4. 본 스크립트 실행
--
-- 반복 실행 안전: 예 (MERGE 사용)
-- ============================================================================
*/

ALTER SESSION SET CURRENT_SCHEMA = nl2sql;
SET SERVEROUTPUT ON;

/*
-- ============================================================================
-- 1단계: FK 제약조건 → table_relationships
-- ============================================================================
-- ALL_CONSTRAINTS / ALL_CONS_COLUMNS에서 FK 정보를 읽어 자동 MERGE합니다.
-- - relationship_type: source 컬럼에 UNIQUE 제약 있으면 ONE_TO_ONE, 없으면 MANY_TO_ONE
-- - confidence_level: FK 존재하므로 항상 HIGH
-- - join_hint: 컬럼이 NOT NULL이면 INNER, nullable이면 LEFT
-- ============================================================================
*/

DECLARE
    v_inserted NUMBER := 0;
    v_updated  NUMBER := 0;
    v_total    NUMBER := 0;
BEGIN
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('1단계: FK 제약조건 → table_relationships');
    DBMS_OUTPUT.PUT_LINE('========================================');

    FOR rec IN (
        SELECT
            fk_col.owner          AS source_schema,
            fk_col.table_name     AS source_table,
            fk_col.column_name    AS source_column,
            pk_col.owner          AS target_schema,
            pk_col.table_name     AS target_table,
            pk_col.column_name    AS target_column,
            /* nullable 여부 */
            CASE
                WHEN tcol.nullable = 'N' THEN 'INNER'
                ELSE 'LEFT'
            END AS join_hint,
            /* UNIQUE 제약 여부로 관계 유형 결정 */
            CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM all_cons_columns ucc
                    JOIN all_constraints uc
                        ON ucc.owner = uc.owner
                        AND ucc.constraint_name = uc.constraint_name
                    WHERE uc.constraint_type IN ('U', 'P')
                      AND ucc.owner = fk_col.owner
                      AND ucc.table_name = fk_col.table_name
                      AND ucc.column_name = fk_col.column_name
                ) THEN 'ONE_TO_ONE'
                ELSE 'MANY_TO_ONE'
            END AS relationship_type
        FROM all_constraints fk_con
        JOIN all_cons_columns fk_col
            ON fk_con.owner = fk_col.owner
            AND fk_con.constraint_name = fk_col.constraint_name
        JOIN all_constraints pk_con
            ON fk_con.r_owner = pk_con.owner
            AND fk_con.r_constraint_name = pk_con.constraint_name
        JOIN all_cons_columns pk_col
            ON pk_con.owner = pk_col.owner
            AND pk_con.constraint_name = pk_col.constraint_name
            AND fk_col.position = pk_col.position
        JOIN all_tab_columns tcol
            ON tcol.owner = fk_col.owner
            AND tcol.table_name = fk_col.table_name
            AND tcol.column_name = fk_col.column_name
        WHERE fk_con.constraint_type = 'R'
          /* 시스템 스키마 제외 */
          AND fk_col.owner NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'OUTLN', 'MDSYS',
                                    'CTXSYS', 'XDB', 'WMSYS', 'APEX_PUBLIC_USER',
                                    'APEX_040000', 'FLOWS_FILES', 'NL2SQL')
          AND pk_col.owner NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'OUTLN', 'MDSYS',
                                    'CTXSYS', 'XDB', 'WMSYS', 'APEX_PUBLIC_USER',
                                    'APEX_040000', 'FLOWS_FILES', 'NL2SQL')
    ) LOOP
        v_total := v_total + 1;

        MERGE INTO table_relationships tr
        USING (
            SELECT
                rec.source_schema  AS source_schema,
                rec.source_table   AS source_table,
                rec.source_column  AS source_column,
                rec.target_schema  AS target_schema,
                rec.target_table   AS target_table,
                rec.target_column  AS target_column
            FROM DUAL
        ) src
        ON (
            tr.source_schema = src.source_schema
            AND tr.source_table  = src.source_table
            AND tr.source_column = src.source_column
            AND tr.target_schema = src.target_schema
            AND tr.target_table  = src.target_table
            AND tr.target_column = src.target_column
        )
        WHEN MATCHED THEN
            UPDATE SET
                tr.relationship_type = rec.relationship_type,
                tr.confidence_level  = 'HIGH',
                tr.join_hint         = rec.join_hint,
                tr.description       = 'FK 제약조건에서 자동 추출',
                tr.updated_at        = SYSTIMESTAMP,
                tr.updated_by        = 'auto_import'
            WHERE tr.created_by = 'auto_import'
        WHEN NOT MATCHED THEN
            INSERT (
                source_schema, source_table, source_column,
                target_schema, target_table, target_column,
                relationship_type, confidence_level, join_hint,
                description, is_active, created_by
            ) VALUES (
                rec.source_schema, rec.source_table, rec.source_column,
                rec.target_schema, rec.target_table, rec.target_column,
                rec.relationship_type, 'HIGH', rec.join_hint,
                'FK 제약조건에서 자동 추출', 1, 'auto_import'
            );

        IF SQL%ROWCOUNT > 0 THEN
            v_inserted := v_inserted + 1;
        END IF;
    END LOOP;

    DBMS_OUTPUT.PUT_LINE('1단계 완료: 총 ' || v_total || '건 처리 (반영: ' || v_inserted || '건)');
    COMMIT;
END;
/

/*
-- ============================================================================
-- 2단계: 코드 테이블 휴리스틱 탐지 → code_tables
-- ============================================================================
-- 소규모 테이블 중 코드성 테이블을 자동 탐지합니다.
-- is_active=0으로 삽입하여 수동 검토 후 활성화합니다.
--
-- 휴리스틱 점수 기준 (3점 이상이면 후보):
--   - 코드 컬럼 존재 (%CODE%, %CD%)                    +1
--   - 이름 컬럼 존재 (%NAME%, %NM%, %LABEL%)            +1
--   - 그룹 컬럼 존재 (%GROUP%, %TYPE%, %CATEGORY%)      +1
--   - 정렬 컬럼 존재 (%ORDER%, %SEQ%, %SORT%)           +1
--   - 활성 플래그 존재 (%ACTIVE%, %USE%, %YN)           +1
--   - 테이블명에 코드 키워드 포함                         +2
--   - 2개 이상 테이블에서 참조됨                          +2
-- ============================================================================
*/

DECLARE
    v_inserted NUMBER := 0;
    v_total    NUMBER := 0;

    /* 컬럼 추정용 변수 */
    v_guessed_code_col   VARCHAR2(128);
    v_guessed_name_col   VARCHAR2(128);
    v_guessed_group_col  VARCHAR2(128);
    v_guessed_sort_col   VARCHAR2(128);
    v_guessed_active_col VARCHAR2(128);
BEGIN
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('2단계: 코드 테이블 휴리스틱 탐지');
    DBMS_OUTPUT.PUT_LINE('========================================');

    FOR rec IN (
        WITH table_stats AS (
            SELECT
                t.owner        AS table_schema,
                t.table_name   AS table_name,
                NVL(t.num_rows, 0) AS estimated_rows
            FROM all_tables t
            WHERE t.owner NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'OUTLN', 'MDSYS',
                                   'CTXSYS', 'XDB', 'WMSYS', 'APEX_PUBLIC_USER',
                                   'APEX_040000', 'FLOWS_FILES', 'NL2SQL')
              AND NVL(t.num_rows, 0) BETWEEN 1 AND 1000
        ),
        scored AS (
            SELECT
                ts.table_schema,
                ts.table_name,
                ts.estimated_rows,
                /* 코드 컬럼 (+1) */
                (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
                 FROM all_tab_columns c
                 WHERE c.owner = ts.table_schema AND c.table_name = ts.table_name
                 AND (UPPER(c.column_name) LIKE '%CODE%' OR UPPER(c.column_name) LIKE '%CD%'))
                +
                /* 이름 컬럼 (+1) */
                (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
                 FROM all_tab_columns c
                 WHERE c.owner = ts.table_schema AND c.table_name = ts.table_name
                 AND (UPPER(c.column_name) LIKE '%NAME%' OR UPPER(c.column_name) LIKE '%NM%'
                      OR UPPER(c.column_name) LIKE '%LABEL%'))
                +
                /* 그룹 컬럼 (+1) */
                (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
                 FROM all_tab_columns c
                 WHERE c.owner = ts.table_schema AND c.table_name = ts.table_name
                 AND (UPPER(c.column_name) LIKE '%GROUP%' OR UPPER(c.column_name) LIKE '%TYPE%'
                      OR UPPER(c.column_name) LIKE '%CATEGORY%'))
                +
                /* 정렬 컬럼 (+1) */
                (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
                 FROM all_tab_columns c
                 WHERE c.owner = ts.table_schema AND c.table_name = ts.table_name
                 AND (UPPER(c.column_name) LIKE '%ORDER%' OR UPPER(c.column_name) LIKE '%SEQ%'
                      OR UPPER(c.column_name) LIKE '%SORT%'))
                +
                /* 활성 플래그 (+1) */
                (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
                 FROM all_tab_columns c
                 WHERE c.owner = ts.table_schema AND c.table_name = ts.table_name
                 AND (UPPER(c.column_name) LIKE '%ACTIVE%' OR UPPER(c.column_name) LIKE '%USE%'
                      OR UPPER(c.column_name) LIKE '%\_YN' ESCAPE '\'))
                +
                /* 테이블명 키워드 (+2) */
                CASE WHEN REGEXP_LIKE(UPPER(ts.table_name),
                    '(CODE|CD|COMMON|MASTER|LOOKUP|REF|TYPE|STATUS|CATEGORY)')
                     THEN 2 ELSE 0 END
                +
                /* 참조 횟수 (+2) */
                CASE WHEN NVL((
                    SELECT COUNT(DISTINCT fk_col.table_name)
                    FROM all_constraints fk_con
                    JOIN all_cons_columns fk_col
                        ON fk_con.owner = fk_col.owner
                        AND fk_con.constraint_name = fk_col.constraint_name
                    JOIN all_constraints pk_con
                        ON fk_con.r_owner = pk_con.owner
                        AND fk_con.r_constraint_name = pk_con.constraint_name
                    WHERE fk_con.constraint_type = 'R'
                      AND pk_con.owner = ts.table_schema
                      AND pk_con.table_name = ts.table_name
                ), 0) >= 2 THEN 2 ELSE 0 END
                AS total_score
            FROM table_stats ts
        )
        SELECT * FROM scored WHERE total_score >= 3
    ) LOOP
        v_total := v_total + 1;

        /* 컬럼 추정 */
        BEGIN
            SELECT column_name INTO v_guessed_code_col
            FROM all_tab_columns
            WHERE owner = rec.table_schema AND table_name = rec.table_name
              AND (UPPER(column_name) LIKE '%CODE%' OR UPPER(column_name) LIKE '%CD%')
              AND ROWNUM = 1
            ORDER BY column_id;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_guessed_code_col := 'CODE';
        END;

        BEGIN
            SELECT column_name INTO v_guessed_name_col
            FROM all_tab_columns
            WHERE owner = rec.table_schema AND table_name = rec.table_name
              AND (UPPER(column_name) LIKE '%NAME%' OR UPPER(column_name) LIKE '%NM%'
                   OR UPPER(column_name) LIKE '%LABEL%')
              AND ROWNUM = 1
            ORDER BY column_id;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_guessed_name_col := 'NAME';
        END;

        BEGIN
            SELECT column_name INTO v_guessed_group_col
            FROM all_tab_columns
            WHERE owner = rec.table_schema AND table_name = rec.table_name
              AND (UPPER(column_name) LIKE '%GROUP%' OR UPPER(column_name) LIKE '%TYPE%'
                   OR UPPER(column_name) LIKE '%CATEGORY%')
              AND ROWNUM = 1
            ORDER BY column_id;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_guessed_group_col := v_guessed_code_col;
        END;

        BEGIN
            SELECT column_name INTO v_guessed_sort_col
            FROM all_tab_columns
            WHERE owner = rec.table_schema AND table_name = rec.table_name
              AND (UPPER(column_name) LIKE '%ORDER%' OR UPPER(column_name) LIKE '%SEQ%'
                   OR UPPER(column_name) LIKE '%SORT%')
              AND ROWNUM = 1
            ORDER BY column_id;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_guessed_sort_col := NULL;
        END;

        BEGIN
            SELECT column_name INTO v_guessed_active_col
            FROM all_tab_columns
            WHERE owner = rec.table_schema AND table_name = rec.table_name
              AND (UPPER(column_name) LIKE '%ACTIVE%' OR UPPER(column_name) LIKE '%USE%'
                   OR UPPER(column_name) LIKE '%\_YN' ESCAPE '\')
              AND ROWNUM = 1
            ORDER BY column_id;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_guessed_active_col := NULL;
        END;

        MERGE INTO code_tables ct
        USING (
            SELECT
                rec.table_schema AS table_schema,
                rec.table_name   AS table_name
            FROM DUAL
        ) src
        ON (ct.table_schema = src.table_schema AND ct.table_name = src.table_name)
        WHEN MATCHED THEN
            UPDATE SET
                ct.group_code_column = v_guessed_group_col,
                ct.code_column       = v_guessed_code_col,
                ct.code_name_column  = v_guessed_name_col,
                ct.sort_order_column = v_guessed_sort_col,
                ct.active_flag_column= v_guessed_active_col,
                ct.description       = '자동 탐지 (점수: ' || rec.total_score || ', 행수: ' || rec.estimated_rows || ')',
                ct.updated_at        = SYSTIMESTAMP
            WHERE ct.code_table_name = rec.table_schema || '.' || rec.table_name
        WHEN NOT MATCHED THEN
            INSERT (
                code_table_name,
                table_schema, table_name,
                group_code_column, code_column, code_name_column,
                sort_order_column, active_flag_column,
                is_active, description
            ) VALUES (
                rec.table_schema || '.' || rec.table_name,
                rec.table_schema, rec.table_name,
                v_guessed_group_col, v_guessed_code_col, v_guessed_name_col,
                v_guessed_sort_col, v_guessed_active_col,
                0,  /* 수동 검토 후 활성화 */
                '자동 탐지 (점수: ' || rec.total_score || ', 행수: ' || rec.estimated_rows || ')'
            );

        IF SQL%ROWCOUNT > 0 THEN
            v_inserted := v_inserted + 1;
        END IF;
    END LOOP;

    DBMS_OUTPUT.PUT_LINE('2단계 완료: 총 ' || v_total || '건 코드테이블 후보 탐지 (반영: ' || v_inserted || '건)');
    DBMS_OUTPUT.PUT_LINE('  → SELECT * FROM code_tables WHERE is_active = 0 으로 검토하세요.');
    COMMIT;
END;
/

/*
-- ============================================================================
-- 3단계: FK → 코드테이블 매핑 → column_code_mapping
-- ============================================================================
-- 1단계(FK)와 2단계(코드테이블) 결과를 조인하여 매핑을 생성합니다.
-- is_active=0, group_code=NULL로 삽입하여 수동 보완이 필요합니다.
-- ============================================================================
*/

DECLARE
    v_inserted NUMBER := 0;
    v_total    NUMBER := 0;
BEGIN
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('3단계: FK → 코드테이블 매핑');
    DBMS_OUTPUT.PUT_LINE('========================================');

    FOR rec IN (
        SELECT
            tr.source_schema,
            tr.source_table,
            tr.source_column,
            ct.code_table_name
        FROM table_relationships tr
        JOIN code_tables ct
            ON tr.target_schema = ct.table_schema
            AND tr.target_table = ct.table_name
        WHERE tr.created_by = 'auto_import'
    ) LOOP
        v_total := v_total + 1;

        MERGE INTO column_code_mapping ccm
        USING (
            SELECT
                rec.source_schema AS target_schema,
                rec.source_table  AS target_table,
                rec.source_column AS target_column
            FROM DUAL
        ) src
        ON (
            ccm.target_schema = src.target_schema
            AND ccm.target_table  = src.target_table
            AND ccm.target_column = src.target_column
        )
        WHEN NOT MATCHED THEN
            INSERT (
                target_schema, target_table, target_column,
                code_table_name, group_code,
                display_name, include_in_prompt,
                is_active, description
            ) VALUES (
                rec.source_schema, rec.source_table, rec.source_column,
                rec.code_table_name, ' ',  /* group_code는 수동 보완 필요 (NOT NULL 대응) */
                rec.source_column,  /* 컬럼명을 display_name으로 사용 */
                1,   /* include_in_prompt */
                0,   /* 수동 검토 후 활성화 */
                'FK→코드테이블 자동 매핑 (group_code 수동 설정 필요)'
            );

        IF SQL%ROWCOUNT > 0 THEN
            v_inserted := v_inserted + 1;
        END IF;
    END LOOP;

    DBMS_OUTPUT.PUT_LINE('3단계 완료: 총 ' || v_total || '건 매핑 후보 (신규: ' || v_inserted || '건)');
    DBMS_OUTPUT.PUT_LINE('  → UPDATE column_code_mapping SET group_code = ''...'', is_active = 1');
    DBMS_OUTPUT.PUT_LINE('    WHERE description LIKE ''FK→코드테이블%'' 로 보완하세요.');
    COMMIT;
END;
/

/*
-- ============================================================================
-- 4단계: 네이밍 컨벤션 기반 관계 추론 → table_relationships
-- ============================================================================
-- naming_conventions 테이블의 패턴을 활용하여 FK 없는 관계를 추론합니다.
-- - confidence_level: MEDIUM
-- - created_by: 'naming_convention'
-- - is_active: 1 (패턴 기반은 비교적 신뢰도가 높으므로 자동 활성화)
-- - 복수형 변환 (+s, +es, y→ies) 지원
-- ============================================================================
*/

DECLARE
    v_inserted NUMBER := 0;
    v_skipped  NUMBER := 0;
    v_total    NUMBER := 0;

    v_candidate_table  VARCHAR2(255);
    v_candidate_column VARCHAR2(255);
    v_actual_table     VARCHAR2(128);
    v_match_group      VARCHAR2(255);
    v_dummy            NUMBER;
BEGIN
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('4단계: 네이밍 컨벤션 기반 관계 추론');
    DBMS_OUTPUT.PUT_LINE('========================================');

    FOR conv IN (
        SELECT * FROM naming_conventions
        WHERE is_active = 1
        ORDER BY priority ASC
    ) LOOP
        FOR col IN (
            SELECT c.owner AS table_schema, c.table_name, c.column_name
            FROM all_tab_columns c
            JOIN all_tables t
                ON c.owner = t.owner AND c.table_name = t.table_name
            WHERE c.owner NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'OUTLN', 'MDSYS',
                                   'CTXSYS', 'XDB', 'WMSYS', 'APEX_PUBLIC_USER',
                                   'APEX_040000', 'FLOWS_FILES', 'NL2SQL')
              AND REGEXP_LIKE(c.column_name, conv.column_pattern, 'i')
        ) LOOP
            v_total := v_total + 1;

            /* 캡처 그룹 추출 ($1) */
            v_match_group := REGEXP_REPLACE(col.column_name, conv.column_pattern, '\1', 1, 1, 'i');

            /* 타겟 테이블/컬럼 패턴 치환 */
            v_candidate_table := REPLACE(conv.target_table_pattern, '$1', v_match_group);
            v_candidate_column := REPLACE(conv.target_column_pattern, '$1', v_match_group);

            /* 접두사/접미사 제거 */
            IF conv.table_prefix_strip IS NOT NULL THEN
                v_candidate_table := REGEXP_REPLACE(v_candidate_table,
                    '^' || conv.table_prefix_strip, '', 1, 1, 'i');
            END IF;
            IF conv.table_suffix_strip IS NOT NULL THEN
                v_candidate_table := REGEXP_REPLACE(v_candidate_table,
                    conv.table_suffix_strip || '$', '', 1, 1, 'i');
            END IF;

            /* 테이블 존재 확인 (원래 형태) */
            v_actual_table := NULL;

            BEGIN
                SELECT t.table_name INTO v_actual_table
                FROM all_tables t
                WHERE t.owner = col.table_schema
                  AND UPPER(t.table_name) = UPPER(v_candidate_table)
                  AND ROWNUM = 1;
            EXCEPTION WHEN NO_DATA_FOUND THEN v_actual_table := NULL;
            END;

            /* 복수형 시도 (apply_pluralization = 1) */
            IF v_actual_table IS NULL AND conv.apply_pluralization = 1 THEN
                /* +s */
                BEGIN
                    SELECT t.table_name INTO v_actual_table
                    FROM all_tables t
                    WHERE t.owner = col.table_schema
                      AND UPPER(t.table_name) = UPPER(v_candidate_table || 'S')
                      AND ROWNUM = 1;
                EXCEPTION WHEN NO_DATA_FOUND THEN v_actual_table := NULL;
                END;

                /* +es */
                IF v_actual_table IS NULL THEN
                    BEGIN
                        SELECT t.table_name INTO v_actual_table
                        FROM all_tables t
                        WHERE t.owner = col.table_schema
                          AND UPPER(t.table_name) = UPPER(v_candidate_table || 'ES')
                          AND ROWNUM = 1;
                    EXCEPTION WHEN NO_DATA_FOUND THEN v_actual_table := NULL;
                    END;
                END IF;

                /* y → ies */
                IF v_actual_table IS NULL AND REGEXP_LIKE(v_candidate_table, 'Y$', 'i') THEN
                    BEGIN
                        SELECT t.table_name INTO v_actual_table
                        FROM all_tables t
                        WHERE t.owner = col.table_schema
                          AND UPPER(t.table_name) = UPPER(
                              REGEXP_REPLACE(v_candidate_table, 'Y$', 'IES', 1, 1, 'i'))
                          AND ROWNUM = 1;
                    EXCEPTION WHEN NO_DATA_FOUND THEN v_actual_table := NULL;
                    END;
                END IF;
            END IF;

            IF v_actual_table IS NULL THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            /* 타겟 컬럼 존재 확인 */
            BEGIN
                SELECT 1 INTO v_dummy
                FROM all_tab_columns c2
                WHERE c2.owner = col.table_schema
                  AND c2.table_name = v_actual_table
                  AND UPPER(c2.column_name) = UPPER(v_candidate_column)
                  AND ROWNUM = 1;
            EXCEPTION WHEN NO_DATA_FOUND THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END;

            /* 자기 참조 제외 */
            IF UPPER(col.table_name) = UPPER(v_actual_table)
               AND UPPER(col.column_name) = UPPER(v_candidate_column) THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            /* MERGE (기존 관계가 있으면 건드리지 않음) */
            MERGE INTO table_relationships tr
            USING (
                SELECT
                    col.table_schema AS source_schema,
                    col.table_name   AS source_table,
                    col.column_name  AS source_column,
                    col.table_schema AS target_schema,
                    v_actual_table   AS target_table,
                    v_candidate_column AS target_column
                FROM DUAL
            ) src
            ON (
                tr.source_schema = src.source_schema
                AND tr.source_table  = src.source_table
                AND tr.source_column = src.source_column
                AND tr.target_schema = src.target_schema
                AND tr.target_table  = src.target_table
                AND tr.target_column = src.target_column
            )
            WHEN NOT MATCHED THEN
                INSERT (
                    source_schema, source_table, source_column,
                    target_schema, target_table, target_column,
                    relationship_type, confidence_level, join_hint,
                    description, is_active, created_by
                ) VALUES (
                    src.source_schema, src.source_table, src.source_column,
                    src.target_schema, src.target_table, src.target_column,
                    'MANY_TO_ONE', 'MEDIUM', 'LEFT',
                    '네이밍 컨벤션 ''' || conv.convention_name || ''' 기반 추론',
                    1, 'naming_convention'
                );

            IF SQL%ROWCOUNT > 0 THEN
                v_inserted := v_inserted + 1;
            ELSE
                v_skipped := v_skipped + 1;
            END IF;
        END LOOP;
    END LOOP;

    DBMS_OUTPUT.PUT_LINE('4단계 완료: 총 ' || v_total || '건 검토 (신규: ' || v_inserted || ', 건너뜀: ' || v_skipped || ')');
    COMMIT;
END;
/

/*
-- ============================================================================
-- 5단계: 동일 컬럼명 기반 관계 추론 → table_relationships
-- ============================================================================
-- 서로 다른 테이블에 동일한 컬럼명이 존재하고,
-- 한쪽에 PK/UK가 있는 경우 관계를 추론합니다.
-- - confidence_level: LOW
-- - created_by: 'column_match'
-- - is_active: 0 (수동 검토 필요)
-- ============================================================================
*/

DECLARE
    v_inserted NUMBER := 0;
    v_skipped  NUMBER := 0;
    v_total    NUMBER := 0;
BEGIN
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('5단계: 동일 컬럼명 기반 관계 추론');
    DBMS_OUTPUT.PUT_LINE('========================================');

    FOR rec IN (
        SELECT
            fk_col.owner        AS source_schema,
            fk_col.table_name   AS source_table,
            fk_col.column_name  AS source_column,
            pk_col.owner        AS target_schema,
            pk_col.table_name   AS target_table,
            pk_col.column_name  AS target_column
        FROM all_tab_columns fk_col
        JOIN all_tab_columns pk_col
            ON UPPER(fk_col.column_name) = UPPER(pk_col.column_name)
            AND UPPER(fk_col.data_type) = UPPER(pk_col.data_type)
            /* 다른 테이블이어야 함 */
            AND NOT (UPPER(fk_col.owner) = UPPER(pk_col.owner)
                     AND UPPER(fk_col.table_name) = UPPER(pk_col.table_name))
        JOIN all_tables ft
            ON fk_col.owner = ft.owner AND fk_col.table_name = ft.table_name
        JOIN all_tables pt
            ON pk_col.owner = pt.owner AND pk_col.table_name = pt.table_name
        WHERE
            /* 시스템 스키마 제외 */
            fk_col.owner NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'OUTLN', 'MDSYS',
                                  'CTXSYS', 'XDB', 'WMSYS', 'APEX_PUBLIC_USER',
                                  'APEX_040000', 'FLOWS_FILES', 'NL2SQL')
            AND pk_col.owner NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'OUTLN', 'MDSYS',
                                      'CTXSYS', 'XDB', 'WMSYS', 'APEX_PUBLIC_USER',
                                      'APEX_040000', 'FLOWS_FILES', 'NL2SQL')
            /* PK 측: PK 또는 UNIQUE 제약 존재 */
            AND EXISTS (
                SELECT 1
                FROM all_cons_columns cc
                JOIN all_constraints c
                    ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
                WHERE c.constraint_type IN ('P', 'U')
                  AND cc.owner = pk_col.owner
                  AND cc.table_name = pk_col.table_name
                  AND cc.column_name = pk_col.column_name
            )
            /* FK 측: PK/UNIQUE 제약 없음 */
            AND NOT EXISTS (
                SELECT 1
                FROM all_cons_columns cc
                JOIN all_constraints c
                    ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
                WHERE c.constraint_type IN ('P', 'U')
                  AND cc.owner = fk_col.owner
                  AND cc.table_name = fk_col.table_name
                  AND cc.column_name = fk_col.column_name
            )
            /* 이미 등록된 관계가 아님 */
            AND NOT EXISTS (
                SELECT 1 FROM table_relationships tr
                WHERE tr.source_schema = fk_col.owner
                  AND tr.source_table  = fk_col.table_name
                  AND tr.source_column = fk_col.column_name
                  AND tr.target_schema = pk_col.owner
                  AND tr.target_table  = pk_col.table_name
                  AND tr.target_column = pk_col.column_name
            )
    ) LOOP
        v_total := v_total + 1;

        MERGE INTO table_relationships tr
        USING (
            SELECT
                rec.source_schema AS source_schema,
                rec.source_table  AS source_table,
                rec.source_column AS source_column,
                rec.target_schema AS target_schema,
                rec.target_table  AS target_table,
                rec.target_column AS target_column
            FROM DUAL
        ) src
        ON (
            tr.source_schema = src.source_schema
            AND tr.source_table  = src.source_table
            AND tr.source_column = src.source_column
            AND tr.target_schema = src.target_schema
            AND tr.target_table  = src.target_table
            AND tr.target_column = src.target_column
        )
        WHEN NOT MATCHED THEN
            INSERT (
                source_schema, source_table, source_column,
                target_schema, target_table, target_column,
                relationship_type, confidence_level, join_hint,
                description, is_active, created_by
            ) VALUES (
                src.source_schema, src.source_table, src.source_column,
                src.target_schema, src.target_table, src.target_column,
                'MANY_TO_ONE', 'LOW', 'LEFT',
                '동일 컬럼명 기반 추론: ' || rec.source_table || '.' || rec.source_column
                    || ' → ' || rec.target_table || '.' || rec.target_column,
                0, 'column_match'
            );

        IF SQL%ROWCOUNT > 0 THEN
            v_inserted := v_inserted + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    DBMS_OUTPUT.PUT_LINE('5단계 완료: 총 ' || v_total || '건 검토 (신규: ' || v_inserted || ', 건너뜀: ' || v_skipped || ')');
    DBMS_OUTPUT.PUT_LINE('  → SELECT * FROM table_relationships WHERE created_by = ''column_match'' AND is_active = 0');
    DBMS_OUTPUT.PUT_LINE('    으로 검토 후 UPDATE ... SET is_active = 1 로 활성화하세요.');
    COMMIT;
END;
/

/*
-- ============================================================================
-- 결과 요약
-- ============================================================================
*/

DECLARE
    v_rel_fk       NUMBER;
    v_rel_naming   NUMBER;
    v_rel_colmatch NUMBER;
    v_code_count   NUMBER;
    v_map_count    NUMBER;
BEGIN
    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('자동 추출 결과 요약');
    DBMS_OUTPUT.PUT_LINE('========================================');

    SELECT COUNT(*) INTO v_rel_fk
    FROM table_relationships
    WHERE created_by = 'auto_import';

    SELECT COUNT(*) INTO v_rel_naming
    FROM table_relationships
    WHERE created_by = 'naming_convention';

    SELECT COUNT(*) INTO v_rel_colmatch
    FROM table_relationships
    WHERE created_by = 'column_match';

    SELECT COUNT(*) INTO v_code_count
    FROM code_tables
    WHERE description LIKE '자동 탐지%';

    SELECT COUNT(*) INTO v_map_count
    FROM column_code_mapping
    WHERE description LIKE 'FK→코드테이블%';

    DBMS_OUTPUT.PUT_LINE('  table_relationships (FK, HIGH):             ' || v_rel_fk || '건');
    DBMS_OUTPUT.PUT_LINE('  table_relationships (naming, MEDIUM, 활성): ' || v_rel_naming || '건');
    DBMS_OUTPUT.PUT_LINE('  table_relationships (colmatch, LOW, 비활성): ' || v_rel_colmatch || '건');
    DBMS_OUTPUT.PUT_LINE('  code_tables (후보, 비활성):                  ' || v_code_count || '건');
    DBMS_OUTPUT.PUT_LINE('  column_code_mapping (후보, 비활성):          ' || v_map_count || '건');
    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('다음 단계:');
    DBMS_OUTPUT.PUT_LINE('  1. SELECT * FROM table_relationships WHERE created_by = ''column_match'' AND is_active = 0;');
    DBMS_OUTPUT.PUT_LINE('     → 동일 컬럼명 추론 관계 검토 후 UPDATE ... SET is_active = 1');
    DBMS_OUTPUT.PUT_LINE('  2. SELECT * FROM code_tables WHERE is_active = 0;');
    DBMS_OUTPUT.PUT_LINE('     → 코드테이블 후보 검토 후 UPDATE ... SET is_active = 1');
    DBMS_OUTPUT.PUT_LINE('  3. SELECT * FROM column_code_mapping WHERE is_active = 0;');
    DBMS_OUTPUT.PUT_LINE('     → group_code 설정 후 UPDATE ... SET is_active = 1');
    DBMS_OUTPUT.PUT_LINE('========================================');
END;
/
