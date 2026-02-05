-- ============================================================================
-- NL2SQL 메타데이터 테이블: 테이블 관계 정의 (MySQL)
-- ============================================================================
--
-- MySQL 특화 사항:
--   - AUTO_INCREMENT 사용 (SERIAL 대신)
--   - ENUM 타입 사용 가능
--   - CHECK 제약조건은 MySQL 8.0.16+ 필요
--   - TEXT 배열 미지원 -> JSON 사용
--   - 부분 인덱스 미지원 -> 일반 인덱스 사용
--   - TIMESTAMP는 자동 업데이트 지원
-- ============================================================================

USE nl2sql;

-- ============================================================================
-- 1. 테이블 관계 정의
-- ============================================================================

CREATE TABLE IF NOT EXISTS table_relationships (
    -- ========================================================================
    -- 기본 식별자
    -- ========================================================================
    id                      INT AUTO_INCREMENT PRIMARY KEY,

    -- ========================================================================
    -- 소스 테이블 정보 (FK 역할 컬럼이 있는 쪽)
    -- ========================================================================
    source_schema           VARCHAR(128) NOT NULL         COMMENT '소스 테이블 스키마(데이터베이스)명',
    source_table            VARCHAR(128) NOT NULL         COMMENT '소스 테이블명',
    source_column           VARCHAR(128) NOT NULL         COMMENT '소스 컬럼명 (FK 역할)',

    -- ========================================================================
    -- 타겟 테이블 정보 (PK가 있는 쪽)
    -- ========================================================================
    target_schema           VARCHAR(128) NOT NULL         COMMENT '타겟 테이블 스키마명',
    target_table            VARCHAR(128) NOT NULL         COMMENT '타겟 테이블명',
    target_column           VARCHAR(128) NOT NULL         COMMENT '타겟 컬럼명 (보통 PK)',

    -- ========================================================================
    -- 관계 메타데이터
    -- ========================================================================
    relationship_type       ENUM('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY')
                            NOT NULL DEFAULT 'MANY_TO_ONE'
                            COMMENT '관계 유형',

    confidence_level        ENUM('HIGH', 'MEDIUM', 'LOW')
                            NOT NULL DEFAULT 'HIGH'
                            COMMENT '관계 신뢰도',

    join_hint               ENUM('INNER', 'LEFT', 'RIGHT')
                            DEFAULT NULL
                            COMMENT 'JOIN 방식 힌트',

    -- ========================================================================
    -- 다형성 관계 지원
    -- ========================================================================
    polymorphic_type_column VARCHAR(128)                  COMMENT '타입 구분 컬럼명',
    polymorphic_type_value  VARCHAR(128)                  COMMENT '해당 관계의 타입 값',

    -- ========================================================================
    -- 설명
    -- ========================================================================
    description             TEXT                          COMMENT '관계 설명',
    business_context        TEXT                          COMMENT '비즈니스 컨텍스트',

    -- ========================================================================
    -- 상태 및 감사
    -- ========================================================================
    is_active               TINYINT(1) NOT NULL DEFAULT 1 COMMENT '활성화 상태 (1=활성, 0=비활성)',
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                            COMMENT '생성 일시',
    created_by              VARCHAR(100)                  COMMENT '생성자',
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                            COMMENT '수정 일시',
    updated_by              VARCHAR(100)                  COMMENT '수정자',

    -- ========================================================================
    -- 제약 조건
    -- ========================================================================
    UNIQUE KEY uk_table_rel (source_schema, source_table, source_column,
                             target_schema, target_table, target_column),
    INDEX idx_rel_source (source_schema, source_table),
    INDEX idx_rel_target (target_schema, target_table),
    INDEX idx_rel_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: FK 없는 테이블 간 관계 수동 정의';


-- ============================================================================
-- 2. 네이밍 컨벤션 정의
-- ============================================================================

CREATE TABLE IF NOT EXISTS naming_conventions (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    convention_name         VARCHAR(100) NOT NULL UNIQUE  COMMENT '컨벤션 이름',

    column_pattern          VARCHAR(255) NOT NULL         COMMENT '컬럼명 매칭 정규표현식',
    target_table_pattern    VARCHAR(255) NOT NULL         COMMENT '타겟 테이블명 패턴',
    target_column_pattern   VARCHAR(255) NOT NULL DEFAULT 'id'
                            COMMENT '타겟 컬럼명 패턴',

    table_prefix_strip      VARCHAR(50)                   COMMENT '제거할 테이블 접두사',
    table_suffix_strip      VARCHAR(50)                   COMMENT '제거할 테이블 접미사',
    apply_pluralization     TINYINT(1) DEFAULT 1          COMMENT '복수형 변환 적용 여부',

    priority                INT NOT NULL DEFAULT 100      COMMENT '우선순위 (낮을수록 먼저)',
    apply_to_schemas        JSON                          COMMENT '적용할 스키마 목록 (JSON 배열)',
    exclude_tables          JSON                          COMMENT '제외할 테이블 목록 (JSON 배열)',

    is_active               TINYINT(1) NOT NULL DEFAULT 1,
    description             TEXT,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_naming_priority (priority, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='NL2SQL 메타데이터: 컬럼명 기반 관계 추론 규칙';


-- ============================================================================
-- 기본 네이밍 컨벤션 데이터
-- ============================================================================
INSERT IGNORE INTO naming_conventions
    (convention_name, column_pattern, target_table_pattern, target_column_pattern,
     priority, apply_pluralization, description)
VALUES
    ('standard_id_suffix',
     '^(.+)_id$', '$1', 'id',
     10, 1,
     '표준 FK 패턴: customer_id -> customers.id'),

    ('standard_no_suffix',
     '^(.+)_no$', '$1', '$1_no',
     20, 1,
     '번호 기반 FK: order_no -> orders.order_no'),

    ('standard_code_suffix',
     '^(.+)_(code|cd)$', '$1', '$1_code',
     30, 1,
     '코드 기반 FK: product_code -> products.product_code');
