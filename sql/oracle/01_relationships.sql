-- ============================================================================
-- NL2SQL 메타데이터 테이블: 테이블 관계 정의 (Oracle)
-- ============================================================================
--
-- Oracle 특화 사항:
--   - IDENTITY 컬럼 사용 (Oracle 12c+) 또는 시퀀스+트리거
--   - VARCHAR2 사용 (VARCHAR 대신)
--   - CHECK 제약조건으로 ENUM 대체
--   - CLOB 타입 (TEXT 대신)
--   - 배열 미지원 -> JSON 또는 CLOB 사용 (Oracle 12c+는 JSON 지원)
--   - TIMESTAMP WITH TIME ZONE 사용
--   - 컬럼/테이블 코멘트는 별도 COMMENT 문 사용
-- ============================================================================

-- 스키마 변경
ALTER SESSION SET CURRENT_SCHEMA = nl2sql;

-- ============================================================================
-- 1. 테이블 관계 정의
-- ============================================================================

CREATE TABLE table_relationships (
    -- ========================================================================
    -- 기본 식별자 (Oracle 12c+ Identity Column)
    -- ========================================================================
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- ========================================================================
    -- 소스 테이블 정보
    -- ========================================================================
    source_schema           VARCHAR2(128) NOT NULL,
    source_table            VARCHAR2(128) NOT NULL,
    source_column           VARCHAR2(128) NOT NULL,

    -- ========================================================================
    -- 타겟 테이블 정보
    -- ========================================================================
    target_schema           VARCHAR2(128) NOT NULL,
    target_table            VARCHAR2(128) NOT NULL,
    target_column           VARCHAR2(128) NOT NULL,

    -- ========================================================================
    -- 관계 메타데이터
    -- ========================================================================
    relationship_type       VARCHAR2(20) DEFAULT 'MANY_TO_ONE' NOT NULL
                            CONSTRAINT chk_rel_type CHECK (relationship_type IN (
                                'ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'
                            )),

    confidence_level        VARCHAR2(10) DEFAULT 'HIGH' NOT NULL
                            CONSTRAINT chk_conf_level CHECK (confidence_level IN (
                                'HIGH', 'MEDIUM', 'LOW'
                            )),

    join_hint               VARCHAR2(20)
                            CONSTRAINT chk_join_hint CHECK (join_hint IS NULL OR join_hint IN (
                                'INNER', 'LEFT', 'RIGHT'
                            )),

    -- ========================================================================
    -- 다형성 관계 지원
    -- ========================================================================
    polymorphic_type_column VARCHAR2(128),
    polymorphic_type_value  VARCHAR2(128),

    -- ========================================================================
    -- 설명
    -- ========================================================================
    description             CLOB,
    business_context        CLOB,

    -- ========================================================================
    -- 상태 및 감사
    -- ========================================================================
    is_active               NUMBER(1) DEFAULT 1 NOT NULL
                            CONSTRAINT chk_rel_active CHECK (is_active IN (0, 1)),
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    created_by              VARCHAR2(100),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_by              VARCHAR2(100),

    -- ========================================================================
    -- 제약 조건
    -- ========================================================================
    CONSTRAINT uk_table_rel UNIQUE (source_schema, source_table, source_column,
                                    target_schema, target_table, target_column)
);

-- 인덱스
CREATE INDEX idx_rel_source ON table_relationships(source_schema, source_table);
CREATE INDEX idx_rel_target ON table_relationships(target_schema, target_table);
CREATE INDEX idx_rel_active ON table_relationships(is_active);

-- 코멘트
COMMENT ON TABLE table_relationships IS
    'NL2SQL 메타데이터: FK 없는 테이블 간 관계 수동 정의';
COMMENT ON COLUMN table_relationships.id IS '자동 생성되는 고유 식별자';
COMMENT ON COLUMN table_relationships.source_schema IS '소스 테이블의 스키마(소유자)명';
COMMENT ON COLUMN table_relationships.source_table IS 'FK 역할 컬럼이 있는 테이블명';
COMMENT ON COLUMN table_relationships.source_column IS '다른 테이블을 참조하는 컬럼명';
COMMENT ON COLUMN table_relationships.target_schema IS '타겟 테이블의 스키마명';
COMMENT ON COLUMN table_relationships.target_table IS '참조 대상 테이블명 (보통 PK 테이블)';
COMMENT ON COLUMN table_relationships.target_column IS '참조되는 컬럼명 (보통 PK)';
COMMENT ON COLUMN table_relationships.relationship_type IS '관계 유형: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY';
COMMENT ON COLUMN table_relationships.confidence_level IS '관계 신뢰도: HIGH(확실), MEDIUM(높은 확률), LOW(추정)';
COMMENT ON COLUMN table_relationships.is_active IS '활성화 상태 (1=활성, 0=비활성)';


-- ============================================================================
-- 2. 네이밍 컨벤션 정의
-- ============================================================================

CREATE TABLE naming_conventions (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    convention_name         VARCHAR2(100) NOT NULL,

    column_pattern          VARCHAR2(255) NOT NULL,
    target_table_pattern    VARCHAR2(255) NOT NULL,
    target_column_pattern   VARCHAR2(255) DEFAULT 'id' NOT NULL,

    table_prefix_strip      VARCHAR2(50),
    table_suffix_strip      VARCHAR2(50),
    apply_pluralization     NUMBER(1) DEFAULT 1,

    priority                NUMBER DEFAULT 100 NOT NULL,
    apply_to_schemas        CLOB,        -- JSON 형태로 저장 (Oracle 12c+ JSON 지원)
    exclude_tables          CLOB,        -- JSON 형태로 저장

    is_active               NUMBER(1) DEFAULT 1 NOT NULL,
    description             CLOB,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT uk_naming_conv UNIQUE (convention_name),
    CONSTRAINT chk_naming_active CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_naming_plural CHECK (apply_pluralization IN (0, 1))
);

-- 인덱스
CREATE INDEX idx_naming_priority ON naming_conventions(priority, is_active);

-- 코멘트
COMMENT ON TABLE naming_conventions IS
    'NL2SQL 메타데이터: 컬럼명 기반 관계 추론 규칙';


-- ============================================================================
-- 트리거 (updated_at 자동 갱신)
-- ============================================================================
CREATE OR REPLACE TRIGGER trg_rel_update_timestamp
    BEFORE UPDATE ON table_relationships
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_naming_update_timestamp
    BEFORE UPDATE ON naming_conventions
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/


-- ============================================================================
-- 기본 네이밍 컨벤션 데이터
-- ============================================================================
INSERT INTO naming_conventions
    (convention_name, column_pattern, target_table_pattern, target_column_pattern,
     priority, apply_pluralization, description)
VALUES
    ('standard_id_suffix',
     '^(.+)_id$', '$1', 'id',
     10, 1,
     '표준 FK 패턴: customer_id -> customers.id');

INSERT INTO naming_conventions
    (convention_name, column_pattern, target_table_pattern, target_column_pattern,
     priority, apply_pluralization, description)
VALUES
    ('standard_no_suffix',
     '^(.+)_no$', '$1', '$1_no',
     20, 1,
     '번호 기반 FK: order_no -> orders.order_no');

COMMIT;
