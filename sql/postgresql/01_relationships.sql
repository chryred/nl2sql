-- ============================================================================
-- NL2SQL 메타데이터 테이블: 테이블 관계 정의 (PostgreSQL)
-- ============================================================================
--
-- 목적:
--   FK(Foreign Key) 제약조건이 설정되지 않은 테이블들 간의 관계를 수동으로 정의합니다.
--   운영자(DBA)가 이 테이블에 데이터를 입력하면, NL2SQL 엔진이 SQL 생성 시
--   테이블 간 JOIN 관계를 정확하게 파악할 수 있습니다.
--
-- PostgreSQL 특화 사항:
--   - SERIAL 타입 사용 (자동 시퀀스 생성)
--   - TEXT[] 배열 타입 지원
--   - 부분 인덱스 (Partial Index) 활용
--   - 정규표현식 연산자 (~) 지원
--
-- 실행 순서:
--   1. 00_create_schema.sql 먼저 실행
--   2. 본 스크립트 실행
-- ============================================================================

-- 기존 테이블 삭제 (개발 환경용, 운영 환경에서는 주석 처리)
-- DROP TABLE IF EXISTS nl2sql.naming_conventions CASCADE;
-- DROP TABLE IF EXISTS nl2sql.table_relationships CASCADE;

-- ============================================================================
-- 1. 테이블 관계 정의
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.table_relationships (
    -- ========================================================================
    -- 기본 식별자
    -- ========================================================================
    id                      SERIAL PRIMARY KEY,           -- 자동 증가 ID

    -- ========================================================================
    -- 소스 테이블 정보 (FK 역할 컬럼이 있는 쪽)
    -- 예: orders 테이블의 customer_id 컬럼
    -- ========================================================================
    source_schema           VARCHAR(128) NOT NULL,        -- 소스 테이블 스키마명
                                                          -- 예: 'public', 'sales'
    source_table            VARCHAR(128) NOT NULL,        -- 소스 테이블명
                                                          -- 예: 'orders', 'order_items'
    source_column           VARCHAR(128) NOT NULL,        -- 소스 컬럼명 (FK 역할)
                                                          -- 예: 'customer_id', 'product_id'

    -- ========================================================================
    -- 타겟 테이블 정보 (PK가 있는 쪽, 참조 대상)
    -- 예: customers 테이블의 id 컬럼
    -- ========================================================================
    target_schema           VARCHAR(128) NOT NULL,        -- 타겟 테이블 스키마명
    target_table            VARCHAR(128) NOT NULL,        -- 타겟 테이블명
                                                          -- 예: 'customers', 'products'
    target_column           VARCHAR(128) NOT NULL,        -- 타겟 컬럼명 (보통 PK)
                                                          -- 예: 'id', 'product_code'

    -- ========================================================================
    -- 관계 메타데이터
    -- ========================================================================
    relationship_type       VARCHAR(20) NOT NULL          -- 관계 유형
                            DEFAULT 'MANY_TO_ONE'
                            CHECK (relationship_type IN (
                                'ONE_TO_ONE',             -- 1:1 관계
                                'ONE_TO_MANY',            -- 1:N 관계 (target이 N)
                                'MANY_TO_ONE',            -- N:1 관계 (가장 일반적)
                                'MANY_TO_MANY'            -- N:M 관계 (중간 테이블)
                            )),

    confidence_level        VARCHAR(10) NOT NULL          -- 관계 신뢰도
                            DEFAULT 'HIGH'                -- 운영자가 직접 입력하므로 HIGH
                            CHECK (confidence_level IN (
                                'HIGH',                   -- 확실한 관계 (운영자 확인)
                                'MEDIUM',                 -- 높은 확률의 관계
                                'LOW'                     -- 추정 관계
                            )),

    join_hint               VARCHAR(20)                   -- JOIN 방식 힌트
                            CHECK (join_hint IS NULL OR join_hint IN (
                                'INNER',                  -- INNER JOIN 권장
                                'LEFT',                   -- LEFT OUTER JOIN 권장
                                'RIGHT'                   -- RIGHT OUTER JOIN 권장
                            )),

    -- ========================================================================
    -- 다형성 관계 지원 (Polymorphic Association)
    -- 하나의 컬럼이 여러 테이블을 참조할 수 있는 경우
    -- 예: comments.commentable_id + commentable_type으로
    --     posts, products, users 등 여러 테이블 참조
    -- ========================================================================
    polymorphic_type_column VARCHAR(128),                 -- 타입 구분 컬럼명
                                                          -- 예: 'commentable_type'
    polymorphic_type_value  VARCHAR(128),                 -- 해당 관계의 타입 값
                                                          -- 예: 'Post', 'Product'

    -- ========================================================================
    -- 설명 및 문서화
    -- ========================================================================
    description             TEXT,                         -- 관계에 대한 상세 설명
                                                          -- 예: '주문과 고객 간의 관계'
    business_context        TEXT,                         -- 비즈니스 컨텍스트
                                                          -- 예: '한 고객은 여러 주문 가능'

    -- ========================================================================
    -- 상태 및 감사 정보
    -- ========================================================================
    is_active               BOOLEAN NOT NULL              -- 활성화 상태
                            DEFAULT TRUE,                 -- FALSE면 무시됨
    created_at              TIMESTAMPTZ NOT NULL          -- 생성 일시
                            DEFAULT CURRENT_TIMESTAMP,
    created_by              VARCHAR(100),                 -- 생성자 ID
    updated_at              TIMESTAMPTZ NOT NULL          -- 수정 일시
                            DEFAULT CURRENT_TIMESTAMP,
    updated_by              VARCHAR(100),                 -- 수정자 ID

    -- ========================================================================
    -- 제약 조건
    -- ========================================================================
    CONSTRAINT uk_nl2sql_table_rel
        UNIQUE (source_schema, source_table, source_column,
                target_schema, target_table, target_column)
);

-- ============================================================================
-- 인덱스 생성
-- ============================================================================
-- 소스 테이블 기준 조회 (가장 빈번한 조회 패턴)
CREATE INDEX IF NOT EXISTS idx_nl2sql_rel_source
    ON nl2sql.table_relationships(source_schema, source_table);

-- 타겟 테이블 기준 조회 (역방향 관계 탐색)
CREATE INDEX IF NOT EXISTS idx_nl2sql_rel_target
    ON nl2sql.table_relationships(target_schema, target_table);

-- 활성 관계만 빠르게 필터링 (부분 인덱스)
CREATE INDEX IF NOT EXISTS idx_nl2sql_rel_active
    ON nl2sql.table_relationships(is_active)
    WHERE is_active = TRUE;

-- ============================================================================
-- 코멘트
-- ============================================================================
COMMENT ON TABLE nl2sql.table_relationships IS
    'NL2SQL 메타데이터: FK 없는 테이블 간 관계를 수동으로 정의';

COMMENT ON COLUMN nl2sql.table_relationships.id IS '자동 생성되는 고유 식별자';
COMMENT ON COLUMN nl2sql.table_relationships.source_schema IS '소스 테이블의 스키마명';
COMMENT ON COLUMN nl2sql.table_relationships.source_table IS 'FK 역할 컬럼이 있는 테이블명';
COMMENT ON COLUMN nl2sql.table_relationships.source_column IS '다른 테이블을 참조하는 컬럼명';
COMMENT ON COLUMN nl2sql.table_relationships.target_schema IS '타겟 테이블의 스키마명';
COMMENT ON COLUMN nl2sql.table_relationships.target_table IS '참조 대상 테이블명 (보통 PK 테이블)';
COMMENT ON COLUMN nl2sql.table_relationships.target_column IS '참조되는 컬럼명 (보통 PK)';
COMMENT ON COLUMN nl2sql.table_relationships.relationship_type IS '관계 유형: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY';
COMMENT ON COLUMN nl2sql.table_relationships.confidence_level IS '관계 신뢰도: HIGH(확실), MEDIUM(높은 확률), LOW(추정)';
COMMENT ON COLUMN nl2sql.table_relationships.is_active IS 'FALSE로 설정하면 이 관계는 무시됨';


-- ============================================================================
-- 2. 네이밍 컨벤션 정의
-- ============================================================================
-- 컬럼명 패턴으로 테이블 관계를 자동 추론하기 위한 규칙 정의
-- 예: customer_id -> customers.id 자동 매핑
-- ============================================================================

CREATE TABLE IF NOT EXISTS nl2sql.naming_conventions (
    -- ========================================================================
    -- 기본 식별자
    -- ========================================================================
    id                      SERIAL PRIMARY KEY,

    -- ========================================================================
    -- 컨벤션 식별
    -- ========================================================================
    convention_name         VARCHAR(100) NOT NULL UNIQUE, -- 컨벤션 이름
                                                          -- 예: 'standard_id_suffix'

    -- ========================================================================
    -- 패턴 정의 (PostgreSQL 정규표현식)
    -- ========================================================================
    column_pattern          VARCHAR(255) NOT NULL,        -- 컬럼명 매칭 정규표현식
                                                          -- 예: '^(.+)_id$'
                                                          -- 캡처 그룹 $1로 테이블명 추출

    target_table_pattern    VARCHAR(255) NOT NULL,        -- 타겟 테이블명 패턴
                                                          -- 예: '$1' 또는 '$1s' (복수형)

    target_column_pattern   VARCHAR(255) NOT NULL         -- 타겟 컬럼명 패턴
                            DEFAULT 'id',                 -- 예: 'id', '$1_id'

    -- ========================================================================
    -- 테이블명 변환 옵션
    -- ========================================================================
    table_prefix_strip      VARCHAR(50),                  -- 제거할 테이블 접두사
                                                          -- 예: 'tb_', 't_'
    table_suffix_strip      VARCHAR(50),                  -- 제거할 테이블 접미사
                                                          -- 예: '_master', '_info'
    apply_pluralization     BOOLEAN DEFAULT TRUE,         -- 복수형 변환 적용 여부
                                                          -- customer -> customers

    -- ========================================================================
    -- 적용 범위
    -- ========================================================================
    priority                INT NOT NULL DEFAULT 100,     -- 우선순위 (낮을수록 먼저)
    apply_to_schemas        TEXT[],                       -- 적용할 스키마 (NULL=전체)
    exclude_tables          TEXT[],                       -- 제외할 테이블 목록

    -- ========================================================================
    -- 상태 및 감사
    -- ========================================================================
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    description             TEXT,                         -- 규칙 설명
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_nl2sql_naming_priority
    ON nl2sql.naming_conventions(priority, is_active);

-- 코멘트
COMMENT ON TABLE nl2sql.naming_conventions IS
    'NL2SQL 메타데이터: 컬럼명 기반 관계 추론을 위한 네이밍 컨벤션 규칙';

COMMENT ON COLUMN nl2sql.naming_conventions.column_pattern IS
    '컬럼명 매칭 정규표현식. 캡처 그룹 사용 가능';
COMMENT ON COLUMN nl2sql.naming_conventions.target_table_pattern IS
    '추론할 타겟 테이블명 패턴. $1, $2 등으로 캡처 그룹 참조';
COMMENT ON COLUMN nl2sql.naming_conventions.apply_pluralization IS
    'TRUE면 추론된 테이블명에 복수형(s/es/ies) 변환 적용';


-- ============================================================================
-- 업데이트 트리거 (updated_at 자동 갱신)
-- ============================================================================
CREATE OR REPLACE FUNCTION nl2sql.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- table_relationships 트리거
DROP TRIGGER IF EXISTS trg_rel_update_timestamp ON nl2sql.table_relationships;
CREATE TRIGGER trg_rel_update_timestamp
    BEFORE UPDATE ON nl2sql.table_relationships
    FOR EACH ROW EXECUTE FUNCTION nl2sql.update_timestamp();

-- naming_conventions 트리거
DROP TRIGGER IF EXISTS trg_naming_update_timestamp ON nl2sql.naming_conventions;
CREATE TRIGGER trg_naming_update_timestamp
    BEFORE UPDATE ON nl2sql.naming_conventions
    FOR EACH ROW EXECUTE FUNCTION nl2sql.update_timestamp();


-- ============================================================================
-- 기본 네이밍 컨벤션 데이터 (선택적 실행)
-- ============================================================================
INSERT INTO nl2sql.naming_conventions
    (convention_name, column_pattern, target_table_pattern, target_column_pattern,
     priority, apply_pluralization, description)
VALUES
    ('standard_id_suffix',
     '^(.+)_id$', '$1', 'id',
     10, TRUE,
     '표준 FK 패턴: customer_id -> customers.id'),

    ('standard_no_suffix',
     '^(.+)_no$', '$1', '$1_no',
     20, TRUE,
     '번호 기반 FK: order_no -> orders.order_no'),

    ('standard_code_suffix',
     '^(.+)_(?:code|cd)$', '$1', '$1_code',
     30, TRUE,
     '코드 기반 FK: product_code -> products.product_code'),

    ('abbreviated_cust',
     '^cust_(.+)$', 'customer', '$1',
     50, TRUE,
     '축약형: cust_id -> customers.id'),

    ('abbreviated_emp',
     '^emp_(.+)$', 'employee', '$1',
     50, TRUE,
     '축약형: emp_id -> employees.id')
ON CONFLICT (convention_name) DO NOTHING;
