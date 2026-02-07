/*
============================================================================
NL2SQL 메타데이터 샘플 데이터 (Oracle)
============================================================================
매장예약시스템(Store Reservation System) 기준 각 메타데이터 테이블별 2건씩 예시
============================================================================
*/

ALTER SESSION SET CURRENT_SCHEMA = nl2sql;

/* ============================================================
   1. table_relationships (테이블 관계) - 2건
   ============================================================ */
INSERT INTO table_relationships
    (source_schema, source_table, source_column,
     target_schema, target_table, target_column,
     relationship_type, confidence_level, join_hint,
     description, business_context, is_active, created_by)
VALUES
    ('NL2SQL', 'RESERVATIONS', 'STORE_ID',
     'NL2SQL', 'STORES', 'STORE_ID',
     'MANY_TO_ONE', 'HIGH', 'INNER',
     '예약 → 매장 관계',
     '예약은 반드시 하나의 매장에 속하며, 매장별 예약 조회 시 사용',
     1, 'manual');

INSERT INTO table_relationships
    (source_schema, source_table, source_column,
     target_schema, target_table, target_column,
     relationship_type, confidence_level, join_hint,
     description, business_context, is_active, created_by)
VALUES
    ('NL2SQL', 'REVIEWS', 'RESERVATION_ID',
     'NL2SQL', 'RESERVATIONS', 'RESERVATION_ID',
     'ONE_TO_ONE', 'HIGH', 'LEFT',
     '리뷰 → 예약 관계',
     '리뷰는 완료된 예약 건에 대해 작성되며, 모든 예약에 리뷰가 있지는 않음',
     1, 'manual');

/* ============================================================
   2. naming_conventions (네이밍 컨벤션) - 2건
   ============================================================
   ※ 00_create_schema.sql에서 기본 2건이 이미 삽입됨.
      여기서는 매장예약시스템 특화 규칙 추가.
   ============================================================ */
INSERT INTO naming_conventions
    (convention_name, column_pattern, target_table_pattern, target_column_pattern,
     priority, apply_pluralization, description)
VALUES
    ('reservation_fk_pattern',
     '^reservation_id$', 'reservations', 'reservation_id',
     5, 0,
     '예약 ID 직접 참조: reservation_id -> reservations.reservation_id');

INSERT INTO naming_conventions
    (convention_name, column_pattern, target_table_pattern, target_column_pattern,
     priority, apply_pluralization, description)
VALUES
    ('store_fk_pattern',
     '^store_id$', 'stores', 'store_id',
     5, 0,
     '매장 ID 직접 참조: store_id -> stores.store_id');

/* ============================================================
   3. code_tables (공통코드 테이블 정의) - 2건
   ============================================================ */
INSERT INTO code_tables
    (code_table_name, table_schema, table_name,
     group_code_column, code_column, code_name_column,
     description_column, sort_order_column, active_flag_column, active_flag_value,
     default_locale, is_active, description)
VALUES
    ('store_common_codes', 'NL2SQL', 'COMMON_CODES',
     'GROUP_CODE', 'CODE', 'CODE_NAME',
     'CODE_DESC', 'SORT_ORDER', 'IS_ACTIVE', '1',
     'ko', 1,
     '매장예약시스템 공통코드 테이블 (STORE_TYPE, RESERVE_STATUS 등)');

INSERT INTO code_tables
    (code_table_name, table_schema, table_name,
     group_code_column, code_column, code_name_column,
     active_flag_column, active_flag_value,
     default_locale, is_active, description)
VALUES
    ('member_grade_inline', 'NL2SQL', 'MEMBERS',
     '''MEMBER_GRADE''', 'MEMBER_GRADE', 'MEMBER_GRADE',
     'IS_ACTIVE', '1',
     'ko', 1,
     '회원 등급 인라인 코드 (NORMAL, SILVER, GOLD, VIP) - CHECK 제약에 정의');

/* ============================================================
   4. column_code_mapping (컬럼-코드그룹 매핑) - 2건
   ============================================================ */
INSERT INTO column_code_mapping
    (target_schema, target_table, target_column,
     code_table_name, group_code,
     display_name, include_in_prompt, is_active, description)
VALUES
    ('NL2SQL', 'STORES', 'STORE_TYPE',
     'store_common_codes', 'STORE_TYPE',
     '매장유형', 1, 1,
     '매장 유형 코드: RESTAURANT(음식점), CAFE(카페), HAIR_SALON(미용실), HOSPITAL(병원), FITNESS(피트니스), ETC(기타)');

INSERT INTO column_code_mapping
    (target_schema, target_table, target_column,
     code_table_name, group_code,
     display_name, include_in_prompt, is_active, description)
VALUES
    ('NL2SQL', 'RESERVATIONS', 'STATUS',
     'store_common_codes', 'RESERVE_STATUS',
     '예약상태', 1, 1,
     '예약 상태 코드: CONFIRMED(확정), COMPLETED(완료), CANCELLED(취소), NO_SHOW(노쇼), WAITING(대기)');

/* ============================================================
   5. code_aliases (코드 별칭) - 2건
   ============================================================ */
INSERT INTO code_aliases
    (code_table_name, group_code, code_value, alias, locale, is_active)
VALUES
    ('store_common_codes', 'STORE_TYPE', 'RESTAURANT', '음식점', 'ko', 1);

INSERT INTO code_aliases
    (code_table_name, group_code, code_value, alias, locale, is_active)
VALUES
    ('store_common_codes', 'RESERVE_STATUS', 'NO_SHOW', '노쇼', 'ko', 1);

/* ============================================================
   6. glossary_terms (비즈니스 용어) - 2건
   ============================================================ */
INSERT INTO glossary_terms
    (term_code, term, category,
     sql_condition, required_columns,
     definition, example_usage, example_sql,
     business_context, priority, is_active, created_by)
VALUES
    ('vip_customer', 'VIP 고객', 'CUSTOMER',
     'member_grade = ''VIP''',
     '["member_grade"]',
     '회원 등급이 VIP인 고객',
     '"VIP 고객의 예약 목록을 조회해줘"',
     'SELECT m.member_name, r.reservation_date FROM members m JOIN reservations r ON m.member_id = r.member_id WHERE m.member_grade = ''VIP''',
     'VIP 등급은 누적 방문 50회 이상 또는 관리자 수동 부여',
     10, 1, 'manual');

INSERT INTO glossary_terms
    (term_code, term, category,
     sql_condition, required_columns,
     definition, example_usage, example_sql,
     business_context, priority, is_active, created_by)
VALUES
    ('noshow_reservation', '노쇼 예약', 'STATUS',
     'status = ''NO_SHOW''',
     '["status"]',
     '예약 후 방문하지 않은 예약 건',
     '"이번 달 노쇼 건수를 알려줘"',
     'SELECT COUNT(*) AS noshow_count FROM reservations WHERE status = ''NO_SHOW'' AND reservation_date >= TRUNC(SYSDATE, ''MM'')',
     '노쇼 3회 이상 시 예약 제한 정책 적용 대상',
     20, 1, 'manual');

/* ============================================================
   7. glossary_aliases (용어 별칭) - 2건
   ============================================================ */
INSERT INTO glossary_aliases
    (term_code, alias, locale, match_type, is_active)
VALUES
    ('vip_customer', 'VIP회원', 'ko', 'EXACT', 1);

INSERT INTO glossary_aliases
    (term_code, alias, locale, match_type, is_active)
VALUES
    ('noshow_reservation', '무단취소', 'ko', 'CONTAINS', 1);

/* ============================================================
   8. glossary_contexts (용어 컨텍스트) - 2건
   ============================================================ */
INSERT INTO glossary_contexts
    (term_code, context_schema, context_table,
     sql_condition, required_columns, context_definition, is_active)
VALUES
    ('vip_customer', 'NL2SQL', 'MEMBERS',
     'member_grade = ''VIP''',
     '["member_grade"]',
     'members 테이블에서 VIP 등급 고객 필터링',
     1);

INSERT INTO glossary_contexts
    (term_code, context_schema, context_table,
     sql_condition, required_columns, context_definition, is_active)
VALUES
    ('noshow_reservation', 'NL2SQL', 'RESERVATIONS',
     'status = ''NO_SHOW''',
     '["status"]',
     'reservations 테이블에서 노쇼 상태 예약 필터링',
     1);

/* ============================================================
   9. query_patterns (쿼리 패턴) - 2건
   ============================================================ */
INSERT INTO query_patterns
    (pattern_code, pattern_name, category,
     sql_template,
     applicable_tables, required_columns, required_joins,
     match_score_threshold, priority,
     description, use_case, example_input, example_output,
     is_active, created_by)
VALUES
    ('store_reservation_count', '매장별 예약 건수 집계', 'AGGREGATION',
     'SELECT s.store_name, COUNT(r.reservation_id) AS reservation_count
FROM stores s
LEFT JOIN reservations r ON s.store_id = r.store_id
  AND r.reservation_date BETWEEN :start_date AND :end_date
GROUP BY s.store_name
ORDER BY reservation_count DESC',
     '["stores", "reservations"]',
     '["store_name", "reservation_id", "reservation_date"]',
     '["stores JOIN reservations ON stores.store_id = reservations.store_id"]',
     70, 10,
     '매장별 예약 건수를 기간별로 집계하는 패턴',
     '특정 기간 내 매장별 예약 현황 파악',
     '"이번 달 매장별 예약 수를 알려줘"',
     'store_name | reservation_count
-----------+---------
강남 헤어샵 | 45
역삼 카페   | 32',
     1, 'manual');

INSERT INTO query_patterns
    (pattern_code, pattern_name, category,
     sql_template,
     applicable_tables, required_columns,
     match_score_threshold, priority,
     description, use_case, example_input, example_output,
     is_active, created_by)
VALUES
    ('member_noshow_ranking', '회원 노쇼 랭킹', 'RANKING',
     'SELECT m.member_name, m.phone, m.total_no_shows,
       RANK() OVER (ORDER BY m.total_no_shows DESC) AS noshow_rank
FROM members m
WHERE m.total_no_shows > 0 AND m.is_active = 1
ORDER BY m.total_no_shows DESC
FETCH FIRST :limit ROWS ONLY',
     '["members"]',
     '["member_name", "phone", "total_no_shows"]',
     70, 20,
     '노쇼 횟수가 높은 회원 순위를 조회하는 패턴',
     '노쇼 블랙리스트 관리 및 정책 적용',
     '"노쇼가 많은 회원 TOP 10을 보여줘"',
     'member_name | phone       | total_no_shows | noshow_rank
-----------+-------------+----------------+------------
김철수      | 010-1234-5678 | 5            | 1
이영희      | 010-9876-5432 | 3            | 2',
     1, 'manual');

/* ============================================================
   10-1. pattern_parameters (패턴 파라미터) - 2건
   ============================================================ */
INSERT INTO pattern_parameters
    (pattern_code, param_name, param_type, is_required,
     default_value, infer_from_keywords,
     description, example_value, display_order, is_active)
VALUES
    ('store_reservation_count', 'start_date', 'DATE', 1,
     'TRUNC(SYSDATE, ''MM'')',
     '["이번달", "이번 달", "이번달부터", "시작일"]',
     '집계 시작일 (기본: 이번 달 1일)',
     'DATE ''2025-01-01''', 1, 1);

INSERT INTO pattern_parameters
    (pattern_code, param_name, param_type, is_required,
     default_value, allowed_values,
     description, example_value, display_order, is_active)
VALUES
    ('member_noshow_ranking', 'limit', 'NUMBER', 0,
     '10', '["5", "10", "20", "50"]',
     '조회할 상위 건수 (기본: 10건)',
     '10', 1, 1);

/* ============================================================
   10-2. pattern_keywords (패턴 키워드) - 2건
   ============================================================ */
INSERT INTO pattern_keywords
    (pattern_code, keyword, locale, weight, match_type, is_required, is_active)
VALUES
    ('store_reservation_count', '매장별', 'ko', 30, 'CONTAINS', 1, 1);

INSERT INTO pattern_keywords
    (pattern_code, keyword, locale, weight, match_type, is_required, is_active)
VALUES
    ('member_noshow_ranking', '노쇼', 'ko', 40, 'CONTAINS', 1, 1);

COMMIT;

PROMPT NL2SQL 메타데이터 샘플 데이터 삽입 완료 (테이블별 2건);
