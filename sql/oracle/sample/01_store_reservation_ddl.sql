-- ============================================================
-- 매장예약시스템 (Store Reservation System) - Oracle DDL
-- 설계: Oracle DBA 전문가 관점
-- ============================================================

-- 1. 시퀀스 생성 (IDENTITY 대신 시퀀스 사용 - 유연성 확보)
-- ============================================================

CREATE SEQUENCE seq_stores START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE seq_store_hours START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE seq_members START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE seq_staff START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE seq_services START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE seq_reservations START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE seq_reservation_services START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE seq_reviews START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE seq_payments START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE seq_notification_log START WITH 1 INCREMENT BY 1 NOCACHE;

-- ============================================================
-- 2. 공통코드 테이블
-- ============================================================

CREATE TABLE common_codes (
    group_code       VARCHAR2(30)   NOT NULL,
    code             VARCHAR2(30)   NOT NULL,
    code_name        VARCHAR2(100)  NOT NULL,
    code_desc        VARCHAR2(500),
    sort_order       NUMBER(3)      DEFAULT 0,
    is_active        NUMBER(1)      DEFAULT 1,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    CONSTRAINT pk_common_codes PRIMARY KEY (group_code, code),
    CONSTRAINT chk_cc_active CHECK (is_active IN (0, 1))
);

COMMENT ON TABLE common_codes IS '공통코드 마스터 테이블';
COMMENT ON COLUMN common_codes.group_code IS '코드 그룹 (STORE_TYPE, RESERVE_STATUS 등)';
COMMENT ON COLUMN common_codes.code IS '코드값';
COMMENT ON COLUMN common_codes.code_name IS '코드명';

-- ============================================================
-- 3. 매장 (Stores)
-- ============================================================

CREATE TABLE stores (
    store_id         NUMBER         NOT NULL,
    store_name       VARCHAR2(200)  NOT NULL,
    store_type       VARCHAR2(30)   NOT NULL,
    phone            VARCHAR2(20),
    email            VARCHAR2(100),
    address          VARCHAR2(500)  NOT NULL,
    address_detail   VARCHAR2(200),
    sido             VARCHAR2(50),
    sigungu          VARCHAR2(50),
    latitude         NUMBER(10, 7),
    longitude        NUMBER(10, 7),
    description      CLOB,
    max_capacity     NUMBER(5)      DEFAULT 0,
    is_active        NUMBER(1)      DEFAULT 1,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_stores PRIMARY KEY (store_id),
    CONSTRAINT chk_store_active CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_store_type CHECK (store_type IN ('RESTAURANT', 'CAFE', 'HAIR_SALON', 'HOSPITAL', 'FITNESS', 'ETC'))
);

COMMENT ON TABLE stores IS '매장 정보 테이블';
COMMENT ON COLUMN stores.store_id IS '매장 고유 ID';
COMMENT ON COLUMN stores.store_name IS '매장명';
COMMENT ON COLUMN stores.store_type IS '매장 유형 (RESTAURANT, CAFE, HAIR_SALON, HOSPITAL, FITNESS, ETC)';
COMMENT ON COLUMN stores.max_capacity IS '최대 수용 인원';

-- ============================================================
-- 4. 매장 영업시간 (Store Hours)
-- ============================================================

CREATE TABLE store_hours (
    hour_id          NUMBER         NOT NULL,
    store_id         NUMBER         NOT NULL,
    day_of_week      VARCHAR2(3)    NOT NULL,
    open_time        VARCHAR2(5)    NOT NULL,
    close_time       VARCHAR2(5)    NOT NULL,
    break_start      VARCHAR2(5),
    break_end        VARCHAR2(5),
    is_holiday       NUMBER(1)      DEFAULT 0,
    CONSTRAINT pk_store_hours PRIMARY KEY (hour_id),
    CONSTRAINT fk_sh_store FOREIGN KEY (store_id) REFERENCES stores(store_id),
    CONSTRAINT uk_sh_store_day UNIQUE (store_id, day_of_week),
    CONSTRAINT chk_sh_dow CHECK (day_of_week IN ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')),
    CONSTRAINT chk_sh_holiday CHECK (is_holiday IN (0, 1))
);

COMMENT ON TABLE store_hours IS '매장 요일별 영업시간';
COMMENT ON COLUMN store_hours.day_of_week IS '요일 (MON~SUN)';
COMMENT ON COLUMN store_hours.open_time IS '오픈시간 (HH24:MI)';
COMMENT ON COLUMN store_hours.close_time IS '마감시간 (HH24:MI)';
COMMENT ON COLUMN store_hours.break_start IS '브레이크타임 시작';
COMMENT ON COLUMN store_hours.break_end IS '브레이크타임 종료';

-- ============================================================
-- 5. 회원 (Members)
-- ============================================================

CREATE TABLE members (
    member_id        NUMBER         NOT NULL,
    member_name      VARCHAR2(100)  NOT NULL,
    phone            VARCHAR2(20)   NOT NULL,
    email            VARCHAR2(100),
    birth_date       DATE,
    gender           VARCHAR2(1),
    member_grade     VARCHAR2(20)   DEFAULT 'NORMAL',
    total_visits     NUMBER(7)      DEFAULT 0,
    total_no_shows   NUMBER(5)      DEFAULT 0,
    is_active        NUMBER(1)      DEFAULT 1,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_members PRIMARY KEY (member_id),
    CONSTRAINT uk_member_phone UNIQUE (phone),
    CONSTRAINT chk_member_gender CHECK (gender IN ('M', 'F')),
    CONSTRAINT chk_member_grade CHECK (member_grade IN ('NORMAL', 'SILVER', 'GOLD', 'VIP')),
    CONSTRAINT chk_member_active CHECK (is_active IN (0, 1))
);

COMMENT ON TABLE members IS '회원 정보 테이블';
COMMENT ON COLUMN members.member_grade IS '회원 등급 (NORMAL, SILVER, GOLD, VIP)';
COMMENT ON COLUMN members.total_visits IS '총 방문 횟수';
COMMENT ON COLUMN members.total_no_shows IS '노쇼 횟수';

-- ============================================================
-- 6. 매장 직원/담당자 (Staff)
-- ============================================================

CREATE TABLE staff (
    staff_id         NUMBER         NOT NULL,
    store_id         NUMBER         NOT NULL,
    staff_name       VARCHAR2(100)  NOT NULL,
    staff_role       VARCHAR2(30)   DEFAULT 'STAFF',
    phone            VARCHAR2(20),
    is_active        NUMBER(1)      DEFAULT 1,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    CONSTRAINT pk_staff PRIMARY KEY (staff_id),
    CONSTRAINT fk_staff_store FOREIGN KEY (store_id) REFERENCES stores(store_id),
    CONSTRAINT chk_staff_role CHECK (staff_role IN ('OWNER', 'MANAGER', 'STAFF')),
    CONSTRAINT chk_staff_active CHECK (is_active IN (0, 1))
);

COMMENT ON TABLE staff IS '매장 직원 정보';
COMMENT ON COLUMN staff.staff_role IS '직원 역할 (OWNER, MANAGER, STAFF)';

-- ============================================================
-- 7. 서비스/메뉴 (Services)
-- ============================================================

CREATE TABLE services (
    service_id       NUMBER         NOT NULL,
    store_id         NUMBER         NOT NULL,
    service_name     VARCHAR2(200)  NOT NULL,
    service_category VARCHAR2(50),
    price            NUMBER(10, 0)  DEFAULT 0,
    duration_min     NUMBER(5)      DEFAULT 60,
    description      VARCHAR2(1000),
    is_active        NUMBER(1)      DEFAULT 1,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    CONSTRAINT pk_services PRIMARY KEY (service_id),
    CONSTRAINT fk_svc_store FOREIGN KEY (store_id) REFERENCES stores(store_id),
    CONSTRAINT chk_svc_active CHECK (is_active IN (0, 1))
);

COMMENT ON TABLE services IS '매장 제공 서비스/메뉴';
COMMENT ON COLUMN services.price IS '가격 (원)';
COMMENT ON COLUMN services.duration_min IS '소요시간 (분)';

-- ============================================================
-- 8. 예약 (Reservations) - 핵심 테이블
-- ============================================================

CREATE TABLE reservations (
    reservation_id   NUMBER         NOT NULL,
    store_id         NUMBER         NOT NULL,
    member_id        NUMBER         NOT NULL,
    staff_id         NUMBER,
    reservation_date DATE           NOT NULL,
    start_time       VARCHAR2(5)    NOT NULL,
    end_time         VARCHAR2(5),
    party_size       NUMBER(3)      DEFAULT 1,
    status           VARCHAR2(20)   DEFAULT 'CONFIRMED',
    cancel_reason    VARCHAR2(500),
    memo             VARCHAR2(1000),
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_reservations PRIMARY KEY (reservation_id),
    CONSTRAINT fk_rsv_store FOREIGN KEY (store_id) REFERENCES stores(store_id),
    CONSTRAINT fk_rsv_member FOREIGN KEY (member_id) REFERENCES members(member_id),
    CONSTRAINT fk_rsv_staff FOREIGN KEY (staff_id) REFERENCES staff(staff_id),
    CONSTRAINT chk_rsv_status CHECK (status IN ('CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'WAITING'))
);

COMMENT ON TABLE reservations IS '예약 정보 테이블 (핵심)';
COMMENT ON COLUMN reservations.reservation_date IS '예약 날짜';
COMMENT ON COLUMN reservations.start_time IS '예약 시작 시간 (HH24:MI)';
COMMENT ON COLUMN reservations.end_time IS '예약 종료 시간 (HH24:MI)';
COMMENT ON COLUMN reservations.party_size IS '예약 인원수';
COMMENT ON COLUMN reservations.status IS '예약 상태 (CONFIRMED, COMPLETED, CANCELLED, NO_SHOW, WAITING)';

CREATE INDEX idx_rsv_store_date ON reservations(store_id, reservation_date);
CREATE INDEX idx_rsv_member ON reservations(member_id);
CREATE INDEX idx_rsv_status ON reservations(status);
CREATE INDEX idx_rsv_date ON reservations(reservation_date);

-- ============================================================
-- 9. 예약별 서비스 (Reservation Services) - M:N 관계
-- ============================================================

CREATE TABLE reservation_services (
    rsv_service_id   NUMBER         NOT NULL,
    reservation_id   NUMBER         NOT NULL,
    service_id       NUMBER         NOT NULL,
    quantity         NUMBER(3)      DEFAULT 1,
    unit_price       NUMBER(10, 0)  DEFAULT 0,
    CONSTRAINT pk_rsv_services PRIMARY KEY (rsv_service_id),
    CONSTRAINT fk_rs_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id),
    CONSTRAINT fk_rs_service FOREIGN KEY (service_id) REFERENCES services(service_id),
    CONSTRAINT uk_rs_rsv_svc UNIQUE (reservation_id, service_id)
);

COMMENT ON TABLE reservation_services IS '예약별 선택 서비스';
COMMENT ON COLUMN reservation_services.unit_price IS '예약 시점 서비스 단가';

-- ============================================================
-- 10. 리뷰 (Reviews)
-- ============================================================

CREATE TABLE reviews (
    review_id        NUMBER         NOT NULL,
    reservation_id   NUMBER         NOT NULL,
    member_id        NUMBER         NOT NULL,
    store_id         NUMBER         NOT NULL,
    rating           NUMBER(1)      NOT NULL,
    content          VARCHAR2(2000),
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    CONSTRAINT pk_reviews PRIMARY KEY (review_id),
    CONSTRAINT fk_rv_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id),
    CONSTRAINT fk_rv_member FOREIGN KEY (member_id) REFERENCES members(member_id),
    CONSTRAINT fk_rv_store FOREIGN KEY (store_id) REFERENCES stores(store_id),
    CONSTRAINT uk_rv_reservation UNIQUE (reservation_id),
    CONSTRAINT chk_rv_rating CHECK (rating BETWEEN 1 AND 5)
);

COMMENT ON TABLE reviews IS '예약 후 리뷰';
COMMENT ON COLUMN reviews.rating IS '평점 (1~5)';

-- ============================================================
-- 11. 결제 (Payments)
-- ============================================================

CREATE TABLE payments (
    payment_id       NUMBER         NOT NULL,
    reservation_id   NUMBER         NOT NULL,
    amount           NUMBER(12, 0)  NOT NULL,
    payment_method   VARCHAR2(20)   NOT NULL,
    payment_status   VARCHAR2(20)   DEFAULT 'PAID',
    paid_at          TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    refund_amount    NUMBER(12, 0)  DEFAULT 0,
    refunded_at      TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_payments PRIMARY KEY (payment_id),
    CONSTRAINT fk_pay_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id),
    CONSTRAINT chk_pay_method CHECK (payment_method IN ('CARD', 'CASH', 'TRANSFER', 'POINT')),
    CONSTRAINT chk_pay_status CHECK (payment_status IN ('PAID', 'REFUNDED', 'PARTIAL_REFUND', 'PENDING'))
);

COMMENT ON TABLE payments IS '결제 정보';
COMMENT ON COLUMN payments.payment_method IS '결제수단 (CARD, CASH, TRANSFER, POINT)';
COMMENT ON COLUMN payments.payment_status IS '결제상태 (PAID, REFUNDED, PARTIAL_REFUND, PENDING)';

-- ============================================================
-- 12. 알림 로그 (Notification Log)
-- ============================================================

CREATE TABLE notification_log (
    log_id           NUMBER         NOT NULL,
    reservation_id   NUMBER,
    member_id        NUMBER,
    noti_type        VARCHAR2(20)   NOT NULL,
    noti_channel     VARCHAR2(20)   NOT NULL,
    title            VARCHAR2(200),
    content          VARCHAR2(2000),
    sent_at          TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
    is_sent          NUMBER(1)      DEFAULT 1,
    CONSTRAINT pk_notification_log PRIMARY KEY (log_id),
    CONSTRAINT fk_noti_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id),
    CONSTRAINT fk_noti_member FOREIGN KEY (member_id) REFERENCES members(member_id),
    CONSTRAINT chk_noti_type CHECK (noti_type IN ('CONFIRM', 'REMIND', 'CANCEL', 'REVIEW_REQUEST', 'PROMOTION')),
    CONSTRAINT chk_noti_channel CHECK (noti_channel IN ('SMS', 'EMAIL', 'PUSH', 'KAKAO')),
    CONSTRAINT chk_noti_sent CHECK (is_sent IN (0, 1))
);

COMMENT ON TABLE notification_log IS '알림 발송 이력';

-- ============================================================
-- 13. Trigger: updated_at 자동 갱신
-- ============================================================

CREATE OR REPLACE TRIGGER trg_stores_update
    BEFORE UPDATE ON stores
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_members_update
    BEFORE UPDATE ON members
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_reservations_update
    BEFORE UPDATE ON reservations
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSTIMESTAMP;
END;
/
