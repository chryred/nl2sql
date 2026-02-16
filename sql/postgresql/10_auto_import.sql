-- ============================================================================
-- NL2SQL 메타데이터 자동 추출 (PostgreSQL)
-- ============================================================================
--
-- 목적:
--   운영 DB의 시스템 카탈로그에서 메타데이터를 자동 추출하여 nl2sql 스키마에 적재합니다.
--   FK 제약조건, 코드성 테이블, 컬럼-코드 매핑, 네이밍 패턴 기반 관계를 자동으로 탐지합니다.
--
-- 특징:
--   - 멱등성 보장 (ON CONFLICT ... DO UPDATE)
--   - created_by='auto_import' 행만 업데이트 (수동 입력 데이터 보호)
--   - 코드테이블/매핑은 is_active=FALSE로 삽입 (수동 검토 후 활성화)
--   - 시스템 스키마 및 nl2sql 스키마 자체 제외
--
-- 실행 순서:
--   1. 00_create_schema.sql
--   2. 01_relationships.sql
--   3. 03_common_codes.sql
--   4. 본 스크립트 실행
--
-- 반복 실행 안전: 예 (UPSERT 사용)
-- ============================================================================

-- ============================================================================
-- 1단계: FK 제약조건 → table_relationships
-- ============================================================================
-- 시스템 카탈로그에서 FK 정보를 읽어 자동 INSERT합니다.
-- - relationship_type: source 컬럼에 UNIQUE 제약 있으면 ONE_TO_ONE, 없으면 MANY_TO_ONE
-- - confidence_level: FK 존재하므로 항상 HIGH
-- - join_hint: 컬럼이 NOT NULL이면 INNER, nullable이면 LEFT
-- ============================================================================

DO $$
DECLARE
    v_inserted INT := 0;
    v_updated  INT := 0;
    v_total    INT := 0;
    rec RECORD;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '1단계: FK 제약조건 → table_relationships';
    RAISE NOTICE '========================================';

    FOR rec IN
        WITH fk_info AS (
            SELECT
                -- 소스 (FK가 있는 쪽)
                fk_tc.table_schema   AS source_schema,
                fk_tc.table_name     AS source_table,
                kcu.column_name      AS source_column,
                -- 타겟 (참조되는 쪽)
                pk_tc.table_schema   AS target_schema,
                pk_tc.table_name     AS target_table,
                pk_kcu.column_name   AS target_column,
                -- nullable 여부
                CASE
                    WHEN col.is_nullable = 'NO' THEN 'INNER'
                    ELSE 'LEFT'
                END AS join_hint,
                -- UNIQUE 제약 여부로 관계 유형 결정
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM information_schema.table_constraints uc
                        JOIN information_schema.key_column_usage ukcu
                            ON uc.constraint_name = ukcu.constraint_name
                            AND uc.table_schema = ukcu.table_schema
                        WHERE uc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
                          AND uc.table_schema = fk_tc.table_schema
                          AND uc.table_name = fk_tc.table_name
                          AND ukcu.column_name = kcu.column_name
                    ) THEN 'ONE_TO_ONE'
                    ELSE 'MANY_TO_ONE'
                END AS relationship_type
            FROM information_schema.table_constraints fk_tc
            JOIN information_schema.key_column_usage kcu
                ON fk_tc.constraint_name = kcu.constraint_name
                AND fk_tc.table_schema = kcu.table_schema
            JOIN information_schema.referential_constraints rc
                ON fk_tc.constraint_name = rc.constraint_name
                AND fk_tc.table_schema = rc.constraint_schema
            JOIN information_schema.table_constraints pk_tc
                ON rc.unique_constraint_name = pk_tc.constraint_name
                AND rc.unique_constraint_schema = pk_tc.table_schema
            JOIN information_schema.key_column_usage pk_kcu
                ON pk_tc.constraint_name = pk_kcu.constraint_name
                AND pk_tc.table_schema = pk_kcu.table_schema
                AND kcu.ordinal_position = pk_kcu.ordinal_position
            JOIN information_schema.columns col
                ON col.table_schema = fk_tc.table_schema
                AND col.table_name = fk_tc.table_name
                AND col.column_name = kcu.column_name
            WHERE fk_tc.constraint_type = 'FOREIGN KEY'
              -- 시스템 스키마 제외
              AND fk_tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'nl2sql')
              AND pk_tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'nl2sql')
        )
        SELECT * FROM fk_info
    LOOP
        v_total := v_total + 1;

        INSERT INTO nl2sql.table_relationships (
            source_schema, source_table, source_column,
            target_schema, target_table, target_column,
            relationship_type, confidence_level, join_hint,
            description, is_active, created_by
        ) VALUES (
            rec.source_schema, rec.source_table, rec.source_column,
            rec.target_schema, rec.target_table, rec.target_column,
            rec.relationship_type, 'HIGH', rec.join_hint,
            'FK 제약조건에서 자동 추출',
            TRUE, 'auto_import'
        )
        ON CONFLICT (source_schema, source_table, source_column,
                     target_schema, target_table, target_column)
        DO UPDATE SET
            relationship_type = EXCLUDED.relationship_type,
            confidence_level  = EXCLUDED.confidence_level,
            join_hint         = EXCLUDED.join_hint,
            description       = EXCLUDED.description,
            updated_at        = CURRENT_TIMESTAMP,
            updated_by        = 'auto_import'
        WHERE nl2sql.table_relationships.created_by = 'auto_import';

        IF FOUND THEN
            -- ON CONFLICT 발생 시 UPDATE 됨 → updated
            -- 신규 INSERT 시에도 FOUND = TRUE
            IF xmax = 0 THEN
                v_inserted := v_inserted + 1;
            ELSE
                v_updated := v_updated + 1;
            END IF;
        END IF;
    END LOOP;

    RAISE NOTICE '1단계 완료: 총 %건 처리 (신규: %, 갱신: %)',
        v_total, v_inserted, v_updated;
END $$;


-- ============================================================================
-- 2단계: 코드 테이블 휴리스틱 탐지 → code_tables
-- ============================================================================
-- 소규모 테이블 중 코드성 테이블을 자동 탐지합니다.
-- is_active=FALSE로 삽입하여 수동 검토 후 활성화합니다.
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

DO $$
DECLARE
    v_inserted INT := 0;
    v_updated  INT := 0;
    v_total    INT := 0;
    rec RECORD;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '2단계: 코드 테이블 휴리스틱 탐지';
    RAISE NOTICE '========================================';

    FOR rec IN
        WITH table_stats AS (
            -- 테이블별 추정 행수 (소규모 테이블 필터링)
            SELECT
                schemaname AS table_schema,
                relname    AS table_name,
                n_live_tup AS estimated_rows
            FROM pg_stat_user_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'nl2sql')
              AND n_live_tup BETWEEN 1 AND 1000
        ),
        column_analysis AS (
            -- 테이블별 컬럼 패턴 분석
            SELECT
                ts.table_schema,
                ts.table_name,
                ts.estimated_rows,
                -- 코드 컬럼 존재 (+1)
                CASE WHEN EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = ts.table_schema
                      AND c.table_name = ts.table_name
                      AND (LOWER(c.column_name) LIKE '%code%'
                           OR LOWER(c.column_name) LIKE '%cd%')
                ) THEN 1 ELSE 0 END AS has_code_col,
                -- 이름 컬럼 존재 (+1)
                CASE WHEN EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = ts.table_schema
                      AND c.table_name = ts.table_name
                      AND (LOWER(c.column_name) LIKE '%name%'
                           OR LOWER(c.column_name) LIKE '%nm%'
                           OR LOWER(c.column_name) LIKE '%label%')
                ) THEN 1 ELSE 0 END AS has_name_col,
                -- 그룹 컬럼 존재 (+1)
                CASE WHEN EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = ts.table_schema
                      AND c.table_name = ts.table_name
                      AND (LOWER(c.column_name) LIKE '%group%'
                           OR LOWER(c.column_name) LIKE '%type%'
                           OR LOWER(c.column_name) LIKE '%category%')
                ) THEN 1 ELSE 0 END AS has_group_col,
                -- 정렬 컬럼 존재 (+1)
                CASE WHEN EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = ts.table_schema
                      AND c.table_name = ts.table_name
                      AND (LOWER(c.column_name) LIKE '%order%'
                           OR LOWER(c.column_name) LIKE '%seq%'
                           OR LOWER(c.column_name) LIKE '%sort%')
                ) THEN 1 ELSE 0 END AS has_sort_col,
                -- 활성 플래그 존재 (+1)
                CASE WHEN EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = ts.table_schema
                      AND c.table_name = ts.table_name
                      AND (LOWER(c.column_name) LIKE '%active%'
                           OR LOWER(c.column_name) LIKE '%use%'
                           OR LOWER(c.column_name) LIKE '%\_yn' ESCAPE '\')
                ) THEN 1 ELSE 0 END AS has_active_col,
                -- 테이블명에 코드 키워드 포함 (+2)
                CASE WHEN LOWER(ts.table_name) ~* '(code|cd|common|master|lookup|ref|type|status|category)'
                     THEN 2 ELSE 0 END AS name_score,
                -- 참조 횟수 (2개 이상이면 +2)
                COALESCE((
                    SELECT COUNT(DISTINCT tc.table_name)
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                        AND tc.table_schema = kcu.table_schema
                    JOIN information_schema.referential_constraints rc
                        ON tc.constraint_name = rc.constraint_name
                        AND tc.table_schema = rc.constraint_schema
                    JOIN information_schema.table_constraints pk_tc
                        ON rc.unique_constraint_name = pk_tc.constraint_name
                        AND rc.unique_constraint_schema = pk_tc.table_schema
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND pk_tc.table_schema = ts.table_schema
                      AND pk_tc.table_name = ts.table_name
                ), 0) AS ref_count
            FROM table_stats ts
        ),
        code_candidates AS (
            SELECT
                ca.*,
                (ca.has_code_col + ca.has_name_col + ca.has_group_col
                 + ca.has_sort_col + ca.has_active_col + ca.name_score
                 + CASE WHEN ca.ref_count >= 2 THEN 2 ELSE 0 END) AS total_score,
                -- 코드 컬럼 추정 (첫 번째 매칭)
                (SELECT c.column_name FROM information_schema.columns c
                 WHERE c.table_schema = ca.table_schema
                   AND c.table_name = ca.table_name
                   AND (LOWER(c.column_name) LIKE '%code%'
                        OR LOWER(c.column_name) LIKE '%cd%')
                 ORDER BY c.ordinal_position LIMIT 1) AS guessed_code_col,
                -- 이름 컬럼 추정
                (SELECT c.column_name FROM information_schema.columns c
                 WHERE c.table_schema = ca.table_schema
                   AND c.table_name = ca.table_name
                   AND (LOWER(c.column_name) LIKE '%name%'
                        OR LOWER(c.column_name) LIKE '%nm%'
                        OR LOWER(c.column_name) LIKE '%label%')
                 ORDER BY c.ordinal_position LIMIT 1) AS guessed_name_col,
                -- 그룹 컬럼 추정
                (SELECT c.column_name FROM information_schema.columns c
                 WHERE c.table_schema = ca.table_schema
                   AND c.table_name = ca.table_name
                   AND (LOWER(c.column_name) LIKE '%group%'
                        OR LOWER(c.column_name) LIKE '%type%'
                        OR LOWER(c.column_name) LIKE '%category%')
                 ORDER BY c.ordinal_position LIMIT 1) AS guessed_group_col,
                -- 정렬 컬럼 추정
                (SELECT c.column_name FROM information_schema.columns c
                 WHERE c.table_schema = ca.table_schema
                   AND c.table_name = ca.table_name
                   AND (LOWER(c.column_name) LIKE '%order%'
                        OR LOWER(c.column_name) LIKE '%seq%'
                        OR LOWER(c.column_name) LIKE '%sort%')
                 ORDER BY c.ordinal_position LIMIT 1) AS guessed_sort_col,
                -- 활성 플래그 컬럼 추정
                (SELECT c.column_name FROM information_schema.columns c
                 WHERE c.table_schema = ca.table_schema
                   AND c.table_name = ca.table_name
                   AND (LOWER(c.column_name) LIKE '%active%'
                        OR LOWER(c.column_name) LIKE '%use%'
                        OR LOWER(c.column_name) LIKE '%\_yn' ESCAPE '\')
                 ORDER BY c.ordinal_position LIMIT 1) AS guessed_active_col
            FROM column_analysis ca
        )
        SELECT * FROM code_candidates
        WHERE total_score >= 3
    LOOP
        v_total := v_total + 1;

        INSERT INTO nl2sql.code_tables (
            code_table_name,
            table_schema, table_name,
            group_code_column, code_column, code_name_column,
            sort_order_column, active_flag_column,
            is_active, description,
            created_at, updated_at
        ) VALUES (
            rec.table_schema || '.' || rec.table_name,
            rec.table_schema, rec.table_name,
            COALESCE(rec.guessed_group_col, rec.guessed_code_col, 'code'),
            COALESCE(rec.guessed_code_col, 'code'),
            COALESCE(rec.guessed_name_col, 'name'),
            rec.guessed_sort_col,
            rec.guessed_active_col,
            FALSE,  -- 수동 검토 후 활성화
            FORMAT('자동 탐지 (점수: %s, 행수: %s)', rec.total_score, rec.estimated_rows),
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (table_schema, table_name)
        DO UPDATE SET
            group_code_column = EXCLUDED.group_code_column,
            code_column       = EXCLUDED.code_column,
            code_name_column  = EXCLUDED.code_name_column,
            sort_order_column = EXCLUDED.sort_order_column,
            active_flag_column= EXCLUDED.active_flag_column,
            description       = EXCLUDED.description,
            updated_at        = CURRENT_TIMESTAMP
        -- code_table_name unique 충돌 시에도 안전하게 처리
        WHERE nl2sql.code_tables.code_table_name = EXCLUDED.code_table_name;

        IF FOUND THEN
            v_inserted := v_inserted + 1;
        END IF;
    END LOOP;

    RAISE NOTICE '2단계 완료: 총 %건 코드테이블 후보 탐지 (처리: %건)',
        v_total, v_inserted;
    RAISE NOTICE '  → SELECT * FROM nl2sql.code_tables WHERE is_active = FALSE 로 검토하세요.';
END $$;


-- ============================================================================
-- 3단계: FK → 코드테이블 매핑 → column_code_mapping
-- ============================================================================
-- 1단계(FK)와 2단계(코드테이블) 결과를 조인하여 매핑을 생성합니다.
-- is_active=FALSE, group_code=NULL로 삽입하여 수동 보완이 필요합니다.
-- ============================================================================

DO $$
DECLARE
    v_inserted INT := 0;
    v_total    INT := 0;
    rec RECORD;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '3단계: FK → 코드테이블 매핑';
    RAISE NOTICE '========================================';

    FOR rec IN
        -- FK로 연결된 테이블 중 code_tables에 등록된 테이블을 찾아 매핑
        SELECT
            tr.source_schema,
            tr.source_table,
            tr.source_column,
            ct.code_table_name
        FROM nl2sql.table_relationships tr
        JOIN nl2sql.code_tables ct
            ON tr.target_schema = ct.table_schema
            AND tr.target_table = ct.table_name
        WHERE tr.created_by = 'auto_import'
          -- 이미 매핑이 존재하는지 확인 (수동 입력 보호)
          AND NOT EXISTS (
              SELECT 1 FROM nl2sql.column_code_mapping ccm
              WHERE ccm.target_schema = tr.source_schema
                AND ccm.target_table  = tr.source_table
                AND ccm.target_column = tr.source_column
                AND ccm.code_table_name != ct.code_table_name
          )
    LOOP
        v_total := v_total + 1;

        INSERT INTO nl2sql.column_code_mapping (
            target_schema, target_table, target_column,
            code_table_name, group_code,
            display_name, include_in_prompt,
            is_active, description,
            created_at, updated_at
        ) VALUES (
            rec.source_schema, rec.source_table, rec.source_column,
            rec.code_table_name, '',  -- group_code는 수동 보완 필요
            rec.source_column,        -- 컬럼명을 display_name으로 사용
            TRUE,
            FALSE,  -- 수동 검토 후 활성화
            'FK→코드테이블 자동 매핑 (group_code 수동 설정 필요)',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (target_schema, target_table, target_column)
        DO NOTHING;  -- 기존 매핑이 있으면 건드리지 않음

        IF FOUND THEN
            v_inserted := v_inserted + 1;
        END IF;
    END LOOP;

    RAISE NOTICE '3단계 완료: 총 %건 매핑 후보 (신규: %건)',
        v_total, v_inserted;
    RAISE NOTICE '  → UPDATE nl2sql.column_code_mapping SET group_code = ''...'', is_active = TRUE';
    RAISE NOTICE '    WHERE description LIKE ''FK→코드테이블%%'' 로 보완하세요.';
END $$;


-- ============================================================================
-- 4단계: 네이밍 컨벤션 기반 관계 추론 → table_relationships
-- ============================================================================
-- naming_conventions 테이블의 패턴을 활용하여 FK 없는 관계를 추론합니다.
-- - confidence_level: MEDIUM (네이밍 패턴 기반이므로)
-- - created_by: 'naming_convention'
-- - is_active: TRUE (패턴 기반은 비교적 신뢰도가 높으므로 자동 활성화)
-- - 복수형 변환 (+s, +es, y→ies) 지원
-- ============================================================================

DO $$
DECLARE
    v_inserted INT := 0;
    v_skipped  INT := 0;
    v_total    INT := 0;
    conv RECORD;
    col  RECORD;
    v_candidate_table  VARCHAR(255);
    v_candidate_column VARCHAR(255);
    v_actual_table     VARCHAR(128);
    v_match            TEXT[];
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '4단계: 네이밍 컨벤션 기반 관계 추론';
    RAISE NOTICE '========================================';

    -- 활성화된 네이밍 컨벤션을 우선순위 순으로 처리
    FOR conv IN
        SELECT * FROM nl2sql.naming_conventions
        WHERE is_active = TRUE
        ORDER BY priority ASC
    LOOP
        -- 사용자 테이블의 모든 컬럼을 순회
        FOR col IN
            SELECT c.table_schema, c.table_name, c.column_name
            FROM information_schema.columns c
            JOIN information_schema.tables t
                ON c.table_schema = t.table_schema AND c.table_name = t.table_name
            WHERE t.table_type = 'BASE TABLE'
              AND c.table_schema NOT IN ('pg_catalog', 'information_schema', 'nl2sql')
              -- 스키마 필터 적용
              AND (conv.apply_to_schemas IS NULL
                   OR c.table_schema = ANY(conv.apply_to_schemas))
              -- 테이블 제외 필터
              AND (conv.exclude_tables IS NULL
                   OR c.table_name != ALL(conv.exclude_tables))
              -- 패턴 매칭
              AND c.column_name ~ conv.column_pattern
        LOOP
            v_total := v_total + 1;

            -- 정규식 캡처 그룹 추출
            v_match := regexp_matches(col.column_name, conv.column_pattern, 'i');

            -- 타겟 테이블/컬럼 패턴 치환 ($1, $2, ...)
            v_candidate_table := conv.target_table_pattern;
            v_candidate_column := conv.target_column_pattern;

            IF array_length(v_match, 1) >= 1 THEN
                v_candidate_table := replace(v_candidate_table, '$1', v_match[1]);
                v_candidate_column := replace(v_candidate_column, '$1', v_match[1]);
            END IF;
            IF array_length(v_match, 1) >= 2 THEN
                v_candidate_table := replace(v_candidate_table, '$2', v_match[2]);
                v_candidate_column := replace(v_candidate_column, '$2', v_match[2]);
            END IF;

            -- 접두사/접미사 제거
            IF conv.table_prefix_strip IS NOT NULL THEN
                v_candidate_table := regexp_replace(v_candidate_table, '^' || conv.table_prefix_strip, '', 'i');
            END IF;
            IF conv.table_suffix_strip IS NOT NULL THEN
                v_candidate_table := regexp_replace(v_candidate_table, conv.table_suffix_strip || '$', '', 'i');
            END IF;

            -- 테이블 존재 확인 (원래 형태 → 복수형 변환)
            v_actual_table := NULL;

            -- 원래 형태
            SELECT t.table_name INTO v_actual_table
            FROM information_schema.tables t
            WHERE t.table_schema = col.table_schema
              AND LOWER(t.table_name) = LOWER(v_candidate_table)
              AND t.table_type = 'BASE TABLE'
            LIMIT 1;

            -- 복수형 시도 (apply_pluralization = TRUE)
            IF v_actual_table IS NULL AND conv.apply_pluralization THEN
                -- +s
                SELECT t.table_name INTO v_actual_table
                FROM information_schema.tables t
                WHERE t.table_schema = col.table_schema
                  AND LOWER(t.table_name) = LOWER(v_candidate_table || 's')
                  AND t.table_type = 'BASE TABLE'
                LIMIT 1;

                -- +es
                IF v_actual_table IS NULL THEN
                    SELECT t.table_name INTO v_actual_table
                    FROM information_schema.tables t
                    WHERE t.table_schema = col.table_schema
                      AND LOWER(t.table_name) = LOWER(v_candidate_table || 'es')
                      AND t.table_type = 'BASE TABLE'
                    LIMIT 1;
                END IF;

                -- y → ies
                IF v_actual_table IS NULL AND v_candidate_table ~ 'y$' THEN
                    SELECT t.table_name INTO v_actual_table
                    FROM information_schema.tables t
                    WHERE t.table_schema = col.table_schema
                      AND LOWER(t.table_name) = LOWER(regexp_replace(v_candidate_table, 'y$', 'ies', 'i'))
                      AND t.table_type = 'BASE TABLE'
                    LIMIT 1;
                END IF;
            END IF;

            IF v_actual_table IS NULL THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            -- 타겟 컬럼 존재 확인
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns c2
                WHERE c2.table_schema = col.table_schema
                  AND c2.table_name = v_actual_table
                  AND LOWER(c2.column_name) = LOWER(v_candidate_column)
            ) THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            -- 자기 참조 제외 (같은 테이블, 같은 컬럼)
            IF LOWER(col.table_name) = LOWER(v_actual_table)
               AND LOWER(col.column_name) = LOWER(v_candidate_column) THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            -- UPSERT (기존 관계가 있으면 건드리지 않음)
            INSERT INTO nl2sql.table_relationships (
                source_schema, source_table, source_column,
                target_schema, target_table, target_column,
                relationship_type, confidence_level, join_hint,
                description, is_active, created_by
            ) VALUES (
                col.table_schema, col.table_name, col.column_name,
                col.table_schema, v_actual_table, v_candidate_column,
                'MANY_TO_ONE', 'MEDIUM', 'LEFT',
                FORMAT('네이밍 컨벤션 ''%s'' 기반 추론', conv.convention_name),
                TRUE, 'naming_convention'
            )
            ON CONFLICT (source_schema, source_table, source_column,
                         target_schema, target_table, target_column)
            DO NOTHING;

            IF FOUND THEN
                v_inserted := v_inserted + 1;
            ELSE
                v_skipped := v_skipped + 1;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE '4단계 완료: 총 %건 검토 (신규: %, 건너뜀: %)',
        v_total, v_inserted, v_skipped;
END $$;


-- ============================================================================
-- 5단계: 동일 컬럼명 기반 관계 추론 → table_relationships
-- ============================================================================
-- 서로 다른 테이블에 동일한 컬럼명이 존재하고,
-- 한쪽에 PK/UK가 있는 경우 관계를 추론합니다.
-- - confidence_level: LOW (동일 컬럼명만으로는 오탐 가능성 있음)
-- - created_by: 'column_match'
-- - is_active: FALSE (수동 검토 필요)
-- - 데이터 타입 호환성 확인 (동일 타입만)
-- ============================================================================

DO $$
DECLARE
    v_inserted INT := 0;
    v_skipped  INT := 0;
    v_total    INT := 0;
    rec RECORD;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '5단계: 동일 컬럼명 기반 관계 추론';
    RAISE NOTICE '========================================';

    FOR rec IN
        -- FK 측 컬럼 (PK/UK 없는 쪽) → PK/UK 측 컬럼 매칭
        SELECT
            fk_col.table_schema AS source_schema,
            fk_col.table_name   AS source_table,
            fk_col.column_name  AS source_column,
            pk_col.table_schema AS target_schema,
            pk_col.table_name   AS target_table,
            pk_col.column_name  AS target_column
        FROM information_schema.columns fk_col
        JOIN information_schema.columns pk_col
            ON LOWER(fk_col.column_name) = LOWER(pk_col.column_name)
            AND LOWER(fk_col.data_type) = LOWER(pk_col.data_type)
            -- 다른 테이블이어야 함
            AND NOT (LOWER(fk_col.table_schema) = LOWER(pk_col.table_schema)
                     AND LOWER(fk_col.table_name) = LOWER(pk_col.table_name))
        JOIN information_schema.tables ft
            ON fk_col.table_schema = ft.table_schema
            AND fk_col.table_name = ft.table_name
            AND ft.table_type = 'BASE TABLE'
        JOIN information_schema.tables pt
            ON pk_col.table_schema = pt.table_schema
            AND pk_col.table_name = pt.table_name
            AND pt.table_type = 'BASE TABLE'
        WHERE
            -- 시스템 스키마 제외
            fk_col.table_schema NOT IN ('pg_catalog', 'information_schema', 'nl2sql')
            AND pk_col.table_schema NOT IN ('pg_catalog', 'information_schema', 'nl2sql')
            -- PK 측: PK 또는 UNIQUE 제약 존재
            AND EXISTS (
                SELECT 1
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
                  AND tc.table_schema = pk_col.table_schema
                  AND tc.table_name = pk_col.table_name
                  AND kcu.column_name = pk_col.column_name
            )
            -- FK 측: PK/UNIQUE 제약 없음 (FK 역할 컬럼)
            AND NOT EXISTS (
                SELECT 1
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
                  AND tc.table_schema = fk_col.table_schema
                  AND tc.table_name = fk_col.table_name
                  AND kcu.column_name = fk_col.column_name
            )
            -- 이미 등록된 관계가 아님
            AND NOT EXISTS (
                SELECT 1 FROM nl2sql.table_relationships tr
                WHERE tr.source_schema = fk_col.table_schema
                  AND tr.source_table  = fk_col.table_name
                  AND tr.source_column = fk_col.column_name
                  AND tr.target_schema = pk_col.table_schema
                  AND tr.target_table  = pk_col.table_name
                  AND tr.target_column = pk_col.column_name
            )
    LOOP
        v_total := v_total + 1;

        INSERT INTO nl2sql.table_relationships (
            source_schema, source_table, source_column,
            target_schema, target_table, target_column,
            relationship_type, confidence_level, join_hint,
            description, is_active, created_by
        ) VALUES (
            rec.source_schema, rec.source_table, rec.source_column,
            rec.target_schema, rec.target_table, rec.target_column,
            'MANY_TO_ONE', 'LOW', 'LEFT',
            FORMAT('동일 컬럼명 기반 추론: %s.%s → %s.%s',
                rec.source_table, rec.source_column,
                rec.target_table, rec.target_column),
            FALSE, 'column_match'
        )
        ON CONFLICT (source_schema, source_table, source_column,
                     target_schema, target_table, target_column)
        DO NOTHING;

        IF FOUND THEN
            v_inserted := v_inserted + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    RAISE NOTICE '5단계 완료: 총 %건 검토 (신규: %, 건너뜀: %)',
        v_total, v_inserted, v_skipped;
    RAISE NOTICE '  → SELECT * FROM nl2sql.table_relationships WHERE created_by = ''column_match'' AND is_active = FALSE';
    RAISE NOTICE '    로 검토 후 UPDATE ... SET is_active = TRUE 로 활성화하세요.';
END $$;


-- ============================================================================
-- 결과 요약
-- ============================================================================

DO $$
DECLARE
    v_rel_fk      INT;
    v_rel_naming  INT;
    v_rel_colmatch INT;
    v_code_count  INT;
    v_map_count   INT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '자동 추출 결과 요약';
    RAISE NOTICE '========================================';

    SELECT COUNT(*) INTO v_rel_fk
    FROM nl2sql.table_relationships
    WHERE created_by = 'auto_import';

    SELECT COUNT(*) INTO v_rel_naming
    FROM nl2sql.table_relationships
    WHERE created_by = 'naming_convention';

    SELECT COUNT(*) INTO v_rel_colmatch
    FROM nl2sql.table_relationships
    WHERE created_by = 'column_match';

    SELECT COUNT(*) INTO v_code_count
    FROM nl2sql.code_tables
    WHERE description LIKE '자동 탐지%';

    SELECT COUNT(*) INTO v_map_count
    FROM nl2sql.column_code_mapping
    WHERE description LIKE 'FK→코드테이블%';

    RAISE NOTICE '  table_relationships (FK, HIGH):             %건', v_rel_fk;
    RAISE NOTICE '  table_relationships (naming, MEDIUM, 활성): %건', v_rel_naming;
    RAISE NOTICE '  table_relationships (colmatch, LOW, 비활성): %건', v_rel_colmatch;
    RAISE NOTICE '  code_tables (후보, 비활성):                  %건', v_code_count;
    RAISE NOTICE '  column_code_mapping (후보, 비활성):          %건', v_map_count;
    RAISE NOTICE '';
    RAISE NOTICE '다음 단계:';
    RAISE NOTICE '  1. SELECT * FROM nl2sql.table_relationships WHERE created_by = ''column_match'' AND is_active = FALSE;';
    RAISE NOTICE '     → 동일 컬럼명 추론 관계 검토 후 UPDATE ... SET is_active = TRUE';
    RAISE NOTICE '  2. SELECT * FROM nl2sql.code_tables WHERE is_active = FALSE;';
    RAISE NOTICE '     → 코드테이블 후보 검토 후 UPDATE ... SET is_active = TRUE';
    RAISE NOTICE '  3. SELECT * FROM nl2sql.column_code_mapping WHERE is_active = FALSE;';
    RAISE NOTICE '     → group_code 설정 후 UPDATE ... SET is_active = TRUE';
    RAISE NOTICE '========================================';
END $$;
