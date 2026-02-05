-- ============================================================================
-- NL2SQL 메타데이터 샘플 데이터 (PostgreSQL)
-- ============================================================================
--
-- 목적:
--   테스트 및 참고용 샘플 데이터를 제공합니다.
--   실제 운영 환경에서는 비즈니스에 맞게 수정하여 사용하세요.
--
-- 실행 순서:
--   1. 00_create_schema.sql
--   2. 01_relationships.sql
--   3. 03_common_codes.sql
--   4. 04_glossary.sql
--   5. 05_query_patterns.sql
--   6. 본 스크립트 실행 (선택)
-- ============================================================================

-- ============================================================================
-- 1. 테이블 관계 샘플
-- ============================================================================
INSERT INTO nl2sql.table_relationships
    (source_schema, source_table, source_column,
     target_schema, target_table, target_column,
     relationship_type, confidence_level, join_hint,
     description, business_context, created_by)
VALUES
    -- 주문 -> 고객
    ('public', 'orders', 'customer_id',
     'public', 'customers', 'id',
     'MANY_TO_ONE', 'HIGH', 'INNER',
     '주문 테이블의 customer_id는 customers 테이블의 id를 참조',
     '한 고객은 여러 주문을 가질 수 있음', 'admin'),

    -- 주문상세 -> 주문
    ('public', 'order_items', 'order_id',
     'public', 'orders', 'id',
     'MANY_TO_ONE', 'HIGH', 'INNER',
     '주문상세 테이블의 order_id는 orders 테이블의 id를 참조',
     '하나의 주문에 여러 상품이 포함될 수 있음', 'admin'),

    -- 주문상세 -> 상품
    ('public', 'order_items', 'product_id',
     'public', 'products', 'id',
     'MANY_TO_ONE', 'HIGH', 'LEFT',
     '주문상세 테이블의 product_id는 products 테이블의 id를 참조',
     '주문된 상품 정보 조회용', 'admin'),

    -- 직원 자기참조 (상사 관계)
    ('hr', 'employees', 'manager_id',
     'hr', 'employees', 'id',
     'MANY_TO_ONE', 'HIGH', 'LEFT',
     '직원 테이블의 manager_id는 상위 관리자의 id를 참조',
     '조직도 구성을 위한 자기 참조 관계', 'admin')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 2. 공통코드 테이블 설정 샘플
-- ============================================================================
INSERT INTO nl2sql.code_tables
    (code_table_name, table_schema, table_name,
     group_code_column, code_column, code_name_column,
     description_column, active_flag_column, active_flag_value,
     description)
VALUES
    ('main_code', 'public', 'common_code',
     'group_code', 'code', 'code_name',
     'description', 'use_yn', 'Y',
     '시스템 메인 공통코드 테이블')
ON CONFLICT (code_table_name) DO NOTHING;


-- ============================================================================
-- 3. 컬럼-코드 매핑 샘플
-- ============================================================================
INSERT INTO nl2sql.column_code_mapping
    (target_schema, target_table, target_column,
     code_table_name, group_code, display_name, description)
VALUES
    ('public', 'orders', 'status',
     'main_code', 'ORD_STATUS', '주문 상태',
     '주문의 처리 상태를 나타내는 코드'),

    ('public', 'orders', 'payment_method',
     'main_code', 'PAY_METHOD', '결제 방법',
     '주문 결제에 사용된 방법'),

    ('public', 'customers', 'customer_type',
     'main_code', 'CUST_TYPE', '고객 유형',
     '고객 분류 유형'),

    ('public', 'customers', 'grade',
     'main_code', 'CUST_GRADE', '고객 등급',
     '고객 등급 (VIP, 일반 등)'),

    ('public', 'products', 'status',
     'main_code', 'PROD_STATUS', '상품 상태',
     '상품의 판매 상태'),

    ('public', 'products', 'category',
     'main_code', 'PROD_CATEGORY', '상품 카테고리',
     '상품 분류 카테고리')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 4. 코드 별칭 샘플 (코드값이 있다고 가정)
-- ============================================================================
INSERT INTO nl2sql.code_aliases
    (code_table_name, group_code, code_value, alias, locale)
VALUES
    -- 주문 상태
    ('main_code', 'ORD_STATUS', '01', '접수', 'ko'),
    ('main_code', 'ORD_STATUS', '01', 'received', 'en'),
    ('main_code', 'ORD_STATUS', '02', '처리중', 'ko'),
    ('main_code', 'ORD_STATUS', '02', '진행중', 'ko'),
    ('main_code', 'ORD_STATUS', '02', 'processing', 'en'),
    ('main_code', 'ORD_STATUS', '03', '완료', 'ko'),
    ('main_code', 'ORD_STATUS', '03', '배송완료', 'ko'),
    ('main_code', 'ORD_STATUS', '03', 'completed', 'en'),
    ('main_code', 'ORD_STATUS', '04', '취소', 'ko'),
    ('main_code', 'ORD_STATUS', '04', 'cancelled', 'en'),

    -- 고객 등급
    ('main_code', 'CUST_GRADE', 'VIP', '우수고객', 'ko'),
    ('main_code', 'CUST_GRADE', 'VIP', '프리미엄', 'ko'),
    ('main_code', 'CUST_GRADE', 'GOLD', '골드', 'ko'),
    ('main_code', 'CUST_GRADE', 'SILVER', '실버', 'ko'),
    ('main_code', 'CUST_GRADE', 'NORMAL', '일반', 'ko')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 5. 비즈니스 용어집 샘플
-- ============================================================================
INSERT INTO nl2sql.glossary_terms
    (term_code, term, category, sql_condition,
     sql_condition_mysql, sql_condition_oracle,
     apply_to_tables, required_columns,
     definition, example_usage, created_by)
VALUES
    -- 고객 관련 용어
    ('ACTIVE_CUSTOMER', '활성 고객', 'CUSTOMER',
     'last_purchase_date >= CURRENT_DATE - INTERVAL ''3 months''',
     'last_purchase_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)',
     'last_purchase_date >= SYSDATE - 90',
     ARRAY['customers'], ARRAY['last_purchase_date'],
     '최근 3개월 내 구매 이력이 있는 고객',
     '"활성 고객 목록을 보여줘"', 'admin'),

    ('VIP_CUSTOMER', 'VIP 고객', 'CUSTOMER',
     '(grade = ''VIP'' OR annual_purchase >= 10000000)',
     '(grade = ''VIP'' OR annual_purchase >= 10000000)',
     '(grade = ''VIP'' OR annual_purchase >= 10000000)',
     ARRAY['customers'], ARRAY['grade', 'annual_purchase'],
     'VIP 등급이거나 연간 구매액이 1000만원 이상인 고객',
     '"VIP 고객 현황을 조회해줘"', 'admin'),

    ('DORMANT_CUSTOMER', '휴면 고객', 'CUSTOMER',
     'last_purchase_date < CURRENT_DATE - INTERVAL ''1 year''',
     'last_purchase_date < DATE_SUB(CURDATE(), INTERVAL 1 YEAR)',
     'last_purchase_date < SYSDATE - 365',
     ARRAY['customers'], ARRAY['last_purchase_date'],
     '최근 1년간 구매 이력이 없는 고객',
     '"휴면 고객 목록을 보여줘"', 'admin'),

    -- 날짜 관련 용어
    ('TODAY', '오늘', 'DATE',
     'CURRENT_DATE',
     'CURDATE()',
     'TRUNC(SYSDATE)',
     NULL, ARRAY[]::TEXT[],
     '현재 날짜', '"오늘 주문 건을 조회해줘"', 'admin'),

    ('THIS_MONTH', '이번 달', 'DATE',
     'DATE_TRUNC(''month'', CURRENT_DATE)',
     'DATE_FORMAT(NOW(), ''%Y-%m-01'')',
     'TRUNC(SYSDATE, ''MM'')',
     NULL, ARRAY[]::TEXT[],
     '현재 월의 시작일', '"이번 달 매출을 보여줘"', 'admin'),

    ('LAST_WEEK', '지난 주', 'DATE',
     'CURRENT_DATE - INTERVAL ''7 days''',
     'DATE_SUB(CURDATE(), INTERVAL 7 DAY)',
     'SYSDATE - 7',
     NULL, ARRAY[]::TEXT[],
     '최근 7일', '"지난 주 주문을 조회해줘"', 'admin'),

    -- 주문 관련 용어
    ('PENDING_ORDER', '미결제 주문', 'ORDER',
     'status IN (''01'', ''02'') AND payment_status = ''PENDING''',
     'status IN (''01'', ''02'') AND payment_status = ''PENDING''',
     'status IN (''01'', ''02'') AND payment_status = ''PENDING''',
     ARRAY['orders'], ARRAY['status', 'payment_status'],
     '주문 상태가 신청 또는 처리중이고 결제가 대기 상태인 주문',
     '"미결제 주문 목록을 보여줘"', 'admin'),

    ('HIGH_VALUE_ORDER', '고액 주문', 'ORDER',
     'total_amount >= 1000000',
     'total_amount >= 1000000',
     'total_amount >= 1000000',
     ARRAY['orders'], ARRAY['total_amount'],
     '주문 금액이 100만원 이상인 주문',
     '"고액 주문을 조회해줘"', 'admin')
ON CONFLICT (term_code) DO NOTHING;


-- ============================================================================
-- 6. 용어 별칭 샘플
-- ============================================================================
INSERT INTO nl2sql.glossary_aliases
    (term_code, alias, locale, match_type)
VALUES
    ('ACTIVE_CUSTOMER', '액티브 고객', 'ko', 'EXACT'),
    ('ACTIVE_CUSTOMER', 'active customer', 'en', 'EXACT'),
    ('ACTIVE_CUSTOMER', '최근 구매 고객', 'ko', 'EXACT'),

    ('VIP_CUSTOMER', '우수 고객', 'ko', 'EXACT'),
    ('VIP_CUSTOMER', '프리미엄 고객', 'ko', 'EXACT'),
    ('VIP_CUSTOMER', 'vip', 'en', 'EXACT'),

    ('DORMANT_CUSTOMER', '잠자는 고객', 'ko', 'EXACT'),
    ('DORMANT_CUSTOMER', '미활동 고객', 'ko', 'EXACT'),

    ('PENDING_ORDER', '결제 대기', 'ko', 'EXACT'),
    ('PENDING_ORDER', '미결제', 'ko', 'CONTAINS'),

    ('HIGH_VALUE_ORDER', '대량 주문', 'ko', 'EXACT'),
    ('HIGH_VALUE_ORDER', '큰 주문', 'ko', 'EXACT')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 7. 쿼리 패턴 샘플
-- ============================================================================
INSERT INTO nl2sql.query_patterns
    (pattern_code, pattern_name, category,
     sql_template, sql_template_mysql, sql_template_oracle,
     required_columns, match_score_threshold, priority,
     description, example_input, example_output, created_by)
VALUES
    ('MONTHLY_SALES', '월별 매출 집계', 'AGGREGATION',
     -- PostgreSQL
     'SELECT
        DATE_TRUNC(''month'', {{date_column}}) as month,
        SUM({{amount_column}}) as total_amount,
        COUNT(*) as order_count
      FROM {{table}}
      WHERE {{conditions}}
      GROUP BY DATE_TRUNC(''month'', {{date_column}})
      ORDER BY month',
     -- MySQL
     'SELECT
        DATE_FORMAT({{date_column}}, ''%Y-%m-01'') as month,
        SUM({{amount_column}}) as total_amount,
        COUNT(*) as order_count
      FROM {{table}}
      WHERE {{conditions}}
      GROUP BY DATE_FORMAT({{date_column}}, ''%Y-%m-01'')
      ORDER BY month',
     -- Oracle
     'SELECT
        TRUNC({{date_column}}, ''MM'') as month,
        SUM({{amount_column}}) as total_amount,
        COUNT(*) as order_count
      FROM {{table}}
      WHERE {{conditions}}
      GROUP BY TRUNC({{date_column}}, ''MM'')
      ORDER BY month',
     ARRAY['order_date', 'total_amount'],
     70, 10,
     '월별로 매출을 집계하는 패턴. 날짜 컬럼과 금액 컬럼이 필요합니다.',
     '"이번 분기 월별 매출을 보여줘", "월별 판매 현황"',
     'SELECT DATE_TRUNC(''month'', order_date) as month, SUM(total_amount)...',
     'admin'),

    ('CUSTOMER_SUMMARY', '고객별 구매 현황', 'AGGREGATION',
     -- PostgreSQL
     'SELECT
        c.{{customer_name_column}} as customer_name,
        COUNT(o.id) as order_count,
        SUM(o.{{amount_column}}) as total_purchase,
        MAX(o.{{date_column}}) as last_purchase_date
      FROM {{customer_table}} c
      LEFT JOIN {{order_table}} o ON c.id = o.customer_id
      WHERE {{conditions}}
      GROUP BY c.id, c.{{customer_name_column}}
      ORDER BY total_purchase DESC',
     -- MySQL (동일)
     'SELECT
        c.{{customer_name_column}} as customer_name,
        COUNT(o.id) as order_count,
        SUM(o.{{amount_column}}) as total_purchase,
        MAX(o.{{date_column}}) as last_purchase_date
      FROM {{customer_table}} c
      LEFT JOIN {{order_table}} o ON c.id = o.customer_id
      WHERE {{conditions}}
      GROUP BY c.id, c.{{customer_name_column}}
      ORDER BY total_purchase DESC',
     -- Oracle (동일)
     'SELECT
        c.{{customer_name_column}} as customer_name,
        COUNT(o.id) as order_count,
        SUM(o.{{amount_column}}) as total_purchase,
        MAX(o.{{date_column}}) as last_purchase_date
      FROM {{customer_table}} c
      LEFT JOIN {{order_table}} o ON c.id = o.customer_id
      WHERE {{conditions}}
      GROUP BY c.id, c.{{customer_name_column}}
      ORDER BY total_purchase DESC',
     ARRAY['customer_name', 'total_amount'],
     60, 20,
     '고객별 구매 현황을 집계하는 패턴',
     '"고객별 구매 현황", "고객별 매출 통계"',
     'SELECT c.customer_name, COUNT(o.id), SUM(o.total_amount)...',
     'admin'),

    ('TOP_N_RANKING', '상위 N개 순위', 'RANKING',
     -- PostgreSQL
     'SELECT
        {{select_columns}},
        RANK() OVER (ORDER BY {{order_column}} DESC) as ranking
      FROM {{table}}
      WHERE {{conditions}}
      ORDER BY {{order_column}} DESC
      LIMIT {{limit}}',
     -- MySQL
     'SELECT
        {{select_columns}},
        RANK() OVER (ORDER BY {{order_column}} DESC) as ranking
      FROM {{table}}
      WHERE {{conditions}}
      ORDER BY {{order_column}} DESC
      LIMIT {{limit}}',
     -- Oracle
     'SELECT
        {{select_columns}},
        RANK() OVER (ORDER BY {{order_column}} DESC) as ranking
      FROM {{table}}
      WHERE {{conditions}}
      ORDER BY {{order_column}} DESC
      FETCH FIRST {{limit}} ROWS ONLY',
     NULL,
     65, 30,
     '상위 N개 항목을 순위와 함께 조회하는 패턴',
     '"매출 상위 10개 상품", "구매 많은 고객 TOP 5"',
     'SELECT product_name, SUM(amount), RANK() OVER...',
     'admin')
ON CONFLICT (pattern_code) DO NOTHING;


-- ============================================================================
-- 8. 패턴 파라미터 샘플
-- ============================================================================
INSERT INTO nl2sql.pattern_parameters
    (pattern_code, param_name, param_type, is_required,
     default_value, infer_from_keywords, infer_from_column_type,
     description, display_order)
VALUES
    ('MONTHLY_SALES', 'date_column', 'COLUMN', TRUE,
     'order_date', ARRAY['날짜', '일자', 'date'], 'timestamp',
     '집계 기준이 되는 날짜 컬럼', 1),

    ('MONTHLY_SALES', 'amount_column', 'COLUMN', TRUE,
     'total_amount', ARRAY['금액', '매출', 'amount', 'sales'], 'numeric',
     '합계를 구할 금액 컬럼', 2),

    ('CUSTOMER_SUMMARY', 'customer_name_column', 'COLUMN', TRUE,
     'customer_name', ARRAY['이름', 'name', '고객명'], 'varchar',
     '고객명 컬럼', 1),

    ('CUSTOMER_SUMMARY', 'amount_column', 'COLUMN', TRUE,
     'total_amount', ARRAY['금액', '매출'], 'numeric',
     '금액 컬럼', 2),

    ('TOP_N_RANKING', 'limit', 'NUMBER', TRUE,
     '10', ARRAY['상위', 'TOP', '개'], NULL,
     '조회할 상위 개수', 1),

    ('TOP_N_RANKING', 'order_column', 'COLUMN', TRUE,
     NULL, ARRAY['기준', '정렬', '순서'], NULL,
     '순위 정렬 기준 컬럼', 2)
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 9. 패턴 키워드 샘플
-- ============================================================================
INSERT INTO nl2sql.pattern_keywords
    (pattern_code, keyword, locale, weight, match_type, is_required)
VALUES
    -- 월별 매출
    ('MONTHLY_SALES', '월별', 'ko', 80, 'CONTAINS', TRUE),
    ('MONTHLY_SALES', 'monthly', 'en', 80, 'CONTAINS', FALSE),
    ('MONTHLY_SALES', '매출', 'ko', 60, 'CONTAINS', FALSE),
    ('MONTHLY_SALES', 'sales', 'en', 60, 'CONTAINS', FALSE),
    ('MONTHLY_SALES', '집계', 'ko', 40, 'CONTAINS', FALSE),
    ('MONTHLY_SALES', '통계', 'ko', 40, 'CONTAINS', FALSE),

    -- 고객별 구매
    ('CUSTOMER_SUMMARY', '고객별', 'ko', 80, 'CONTAINS', TRUE),
    ('CUSTOMER_SUMMARY', '구매', 'ko', 60, 'CONTAINS', FALSE),
    ('CUSTOMER_SUMMARY', '현황', 'ko', 40, 'CONTAINS', FALSE),
    ('CUSTOMER_SUMMARY', '통계', 'ko', 40, 'CONTAINS', FALSE),

    -- 상위 순위
    ('TOP_N_RANKING', '상위', 'ko', 70, 'CONTAINS', FALSE),
    ('TOP_N_RANKING', 'TOP', 'en', 70, 'CONTAINS', FALSE),
    ('TOP_N_RANKING', '순위', 'ko', 60, 'CONTAINS', FALSE),
    ('TOP_N_RANKING', '랭킹', 'ko', 60, 'CONTAINS', FALSE),
    ('TOP_N_RANKING', '베스트', 'ko', 50, 'CONTAINS', FALSE)
ON CONFLICT DO NOTHING;
