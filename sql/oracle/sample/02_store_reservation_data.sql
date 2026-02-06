-- ============================================================
-- 매장예약시스템 샘플 데이터 - Oracle
-- FK 의존관계 순서로 INSERT
-- 순서: 공통코드 → 매장 → 영업시간 → 회원 → 직원 → 서비스
--       → 예약 → 예약서비스 → 리뷰 → 결제 → 알림로그
-- ============================================================

-- ============================================================
-- 1. 공통코드 (common_codes) - 의존 없음
-- ============================================================

-- 매장유형
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('STORE_TYPE', 'RESTAURANT', '음식점', '일반 음식점 및 레스토랑', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('STORE_TYPE', 'CAFE', '카페', '카페 및 디저트 전문점', 2);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('STORE_TYPE', 'HAIR_SALON', '미용실', '헤어살롱 및 미용실', 3);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('STORE_TYPE', 'HOSPITAL', '병원', '병원 및 의원', 4);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('STORE_TYPE', 'FITNESS', '피트니스', '헬스장 및 PT센터', 5);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('STORE_TYPE', 'ETC', '기타', '기타 매장', 6);

-- 예약상태
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('RESERVE_STATUS', 'CONFIRMED', '확정', '예약 확정 상태', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('RESERVE_STATUS', 'COMPLETED', '완료', '방문 완료', 2);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('RESERVE_STATUS', 'CANCELLED', '취소', '예약 취소', 3);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('RESERVE_STATUS', 'NO_SHOW', '노쇼', '예약 불이행', 4);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('RESERVE_STATUS', 'WAITING', '대기', '대기 상태', 5);

-- 회원등급
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('MEMBER_GRADE', 'NORMAL', '일반', '일반 회원', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('MEMBER_GRADE', 'SILVER', '실버', '실버 등급', 2);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('MEMBER_GRADE', 'GOLD', '골드', '골드 등급', 3);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('MEMBER_GRADE', 'VIP', 'VIP', 'VIP 회원', 4);

-- 결제수단
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('PAY_METHOD', 'CARD', '카드', '신용/체크 카드 결제', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('PAY_METHOD', 'CASH', '현금', '현금 결제', 2);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('PAY_METHOD', 'TRANSFER', '계좌이체', '계좌이체', 3);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('PAY_METHOD', 'POINT', '포인트', '포인트 결제', 4);

-- 결제상태
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('PAY_STATUS', 'PAID', '결제완료', '정상 결제 완료', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('PAY_STATUS', 'REFUNDED', '전액환불', '전액 환불 처리됨', 2);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('PAY_STATUS', 'PARTIAL_REFUND', '부분환불', '부분 환불 처리됨', 3);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('PAY_STATUS', 'PENDING', '대기', '결제 대기 중', 4);

-- 알림유형
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('NOTI_TYPE', 'CONFIRM', '예약확인', '예약 확정 알림', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('NOTI_TYPE', 'REMIND', '리마인드', '방문일 리마인드 알림', 2);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('NOTI_TYPE', 'CANCEL', '취소알림', '예약 취소 알림', 3);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('NOTI_TYPE', 'REVIEW_REQUEST', '리뷰요청', '리뷰 작성 요청', 4);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('NOTI_TYPE', 'PROMOTION', '프로모션', '이벤트/프로모션 알림', 5);

-- 알림채널
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('NOTI_CHANNEL', 'SMS', 'SMS', '문자 메시지', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('NOTI_CHANNEL', 'EMAIL', '이메일', '이메일 발송', 2);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('NOTI_CHANNEL', 'PUSH', '푸시', '앱 푸시 알림', 3);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('NOTI_CHANNEL', 'KAKAO', '카카오톡', '카카오 알림톡', 4);

-- 직원역할
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('STAFF_ROLE', 'OWNER', '대표', '매장 대표/사장', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('STAFF_ROLE', 'MANAGER', '매니저', '매장 매니저', 2);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('STAFF_ROLE', 'STAFF', '직원', '일반 직원', 3);

-- 요일
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('DAY_OF_WEEK', 'MON', '월요일', '월요일', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('DAY_OF_WEEK', 'TUE', '화요일', '화요일', 2);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('DAY_OF_WEEK', 'WED', '수요일', '수요일', 3);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('DAY_OF_WEEK', 'THU', '목요일', '목요일', 4);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('DAY_OF_WEEK', 'FRI', '금요일', '금요일', 5);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('DAY_OF_WEEK', 'SAT', '토요일', '토요일', 6);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('DAY_OF_WEEK', 'SUN', '일요일', '일요일', 7);

-- 성별
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('GENDER', 'M', '남성', '남성', 1);
INSERT INTO common_codes (group_code, code, code_name, code_desc, sort_order) VALUES ('GENDER', 'F', '여성', '여성', 2);

-- ============================================================
-- 2. 매장 (stores) - 의존 없음
-- ============================================================

INSERT INTO stores (store_id, store_name, store_type, phone, email, address, address_detail, sido, sigungu, latitude, longitude, description, max_capacity)
VALUES (seq_stores.NEXTVAL, '맛있는 한식당', 'RESTAURANT', '02-1234-5678', 'hansik@example.com', '서울특별시 강남구 테헤란로 123', '1층', '서울특별시', '강남구', 37.5012743, 127.0396857, '전통 한식을 현대적으로 재해석한 프리미엄 한식당', 40);

INSERT INTO stores (store_id, store_name, store_type, phone, email, address, address_detail, sido, sigungu, latitude, longitude, description, max_capacity)
VALUES (seq_stores.NEXTVAL, '카페 모닝글로리', 'CAFE', '02-2345-6789', 'morning@example.com', '서울특별시 마포구 연남로 45', '2층', '서울특별시', '마포구', 37.5604762, 126.9235229, '핸드드립 스페셜티 커피 전문 카페', 25);

INSERT INTO stores (store_id, store_name, store_type, phone, email, address, address_detail, sido, sigungu, latitude, longitude, description, max_capacity)
VALUES (seq_stores.NEXTVAL, '헤어스튜디오 블룸', 'HAIR_SALON', '02-3456-7890', 'bloom@example.com', '서울특별시 서초구 서초대로 78', 'B1층', '서울특별시', '서초구', 37.4923615, 127.0292881, '트렌디한 스타일링 전문 헤어살롱', 10);

INSERT INTO stores (store_id, store_name, store_type, phone, email, address, address_detail, sido, sigungu, latitude, longitude, description, max_capacity)
VALUES (seq_stores.NEXTVAL, '이탈리안 비스트로', 'RESTAURANT', '02-4567-8901', 'bistro@example.com', '서울특별시 용산구 이태원로 200', NULL, '서울특별시', '용산구', 37.5340396, 126.9948462, '정통 이탈리안 파스타와 피자', 30);

INSERT INTO stores (store_id, store_name, store_type, phone, email, address, address_detail, sido, sigungu, latitude, longitude, description, max_capacity)
VALUES (seq_stores.NEXTVAL, '바디핏 피트니스', 'FITNESS', '031-567-8901', 'bodyfit@example.com', '경기도 성남시 분당구 판교역로 50', '3층', '경기도', '성남시 분당구', 37.3947670, 127.1112560, 'PT 전문 피트니스 센터', 50);

-- ============================================================
-- 3. 매장 영업시간 (store_hours) - stores 의존
-- ============================================================

-- 매장 1: 맛있는 한식당 (월~토 영업, 일요일 휴무)
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 1, 'MON', '11:00', '21:00', '15:00', '17:00', 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 1, 'TUE', '11:00', '21:00', '15:00', '17:00', 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 1, 'WED', '11:00', '21:00', '15:00', '17:00', 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 1, 'THU', '11:00', '21:00', '15:00', '17:00', 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 1, 'FRI', '11:00', '22:00', '15:00', '17:00', 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 1, 'SAT', '11:00', '22:00', NULL, NULL, 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 1, 'SUN', '00:00', '00:00', NULL, NULL, 1);

-- 매장 2: 카페 모닝글로리 (매일 영업)
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 2, 'MON', '08:00', '22:00', NULL, NULL, 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 2, 'TUE', '08:00', '22:00', NULL, NULL, 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 2, 'WED', '08:00', '22:00', NULL, NULL, 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 2, 'THU', '08:00', '22:00', NULL, NULL, 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 2, 'FRI', '08:00', '23:00', NULL, NULL, 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 2, 'SAT', '09:00', '23:00', NULL, NULL, 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 2, 'SUN', '09:00', '21:00', NULL, NULL, 0);

-- 매장 3: 헤어스튜디오 블룸 (월 휴무)
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 3, 'MON', '00:00', '00:00', NULL, NULL, 1);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 3, 'TUE', '10:00', '20:00', '13:00', '14:00', 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 3, 'WED', '10:00', '20:00', '13:00', '14:00', 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 3, 'THU', '10:00', '20:00', '13:00', '14:00', 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 3, 'FRI', '10:00', '20:00', '13:00', '14:00', 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 3, 'SAT', '10:00', '18:00', NULL, NULL, 0);
INSERT INTO store_hours (hour_id, store_id, day_of_week, open_time, close_time, break_start, break_end, is_holiday) VALUES (seq_store_hours.NEXTVAL, 3, 'SUN', '10:00', '18:00', NULL, NULL, 0);

-- ============================================================
-- 4. 회원 (members) - 의존 없음
-- ============================================================

INSERT INTO members (member_id, member_name, phone, email, birth_date, gender, member_grade, total_visits, total_no_shows)
VALUES (seq_members.NEXTVAL, '김민수', '010-1111-1001', 'minsu.kim@example.com', TO_DATE('1990-03-15', 'YYYY-MM-DD'), 'M', 'VIP', 25, 0);

INSERT INTO members (member_id, member_name, phone, email, birth_date, gender, member_grade, total_visits, total_no_shows)
VALUES (seq_members.NEXTVAL, '이서연', '010-1111-1002', 'seoyeon.lee@example.com', TO_DATE('1995-07-22', 'YYYY-MM-DD'), 'F', 'GOLD', 15, 1);

INSERT INTO members (member_id, member_name, phone, email, birth_date, gender, member_grade, total_visits, total_no_shows)
VALUES (seq_members.NEXTVAL, '박준호', '010-1111-1003', 'junho.park@example.com', TO_DATE('1988-11-30', 'YYYY-MM-DD'), 'M', 'SILVER', 8, 0);

INSERT INTO members (member_id, member_name, phone, email, birth_date, gender, member_grade, total_visits, total_no_shows)
VALUES (seq_members.NEXTVAL, '최유진', '010-1111-1004', 'yujin.choi@example.com', TO_DATE('1992-05-10', 'YYYY-MM-DD'), 'F', 'NORMAL', 3, 2);

INSERT INTO members (member_id, member_name, phone, email, birth_date, gender, member_grade, total_visits, total_no_shows)
VALUES (seq_members.NEXTVAL, '정다은', '010-1111-1005', 'daeun.jung@example.com', TO_DATE('1998-01-25', 'YYYY-MM-DD'), 'F', 'GOLD', 12, 0);

INSERT INTO members (member_id, member_name, phone, email, birth_date, gender, member_grade, total_visits, total_no_shows)
VALUES (seq_members.NEXTVAL, '한태영', '010-1111-1006', 'taeyoung.han@example.com', TO_DATE('1985-09-08', 'YYYY-MM-DD'), 'M', 'VIP', 30, 0);

INSERT INTO members (member_id, member_name, phone, email, birth_date, gender, member_grade, total_visits, total_no_shows)
VALUES (seq_members.NEXTVAL, '오수빈', '010-1111-1007', 'subin.oh@example.com', TO_DATE('2000-12-03', 'YYYY-MM-DD'), 'F', 'NORMAL', 2, 1);

INSERT INTO members (member_id, member_name, phone, email, birth_date, gender, member_grade, total_visits, total_no_shows)
VALUES (seq_members.NEXTVAL, '윤성호', '010-1111-1008', 'sungho.yoon@example.com', TO_DATE('1993-06-17', 'YYYY-MM-DD'), 'M', 'SILVER', 7, 0);

-- ============================================================
-- 5. 직원 (staff) - stores 의존
-- ============================================================

-- 매장 1: 맛있는 한식당
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 1, '김사장', 'OWNER', '010-2222-0001');
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 1, '이매니저', 'MANAGER', '010-2222-0002');
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 1, '박직원', 'STAFF', '010-2222-0003');

-- 매장 2: 카페 모닝글로리
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 2, '최카페', 'OWNER', '010-2222-0004');
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 2, '정바리스타', 'STAFF', '010-2222-0005');

-- 매장 3: 헤어스튜디오 블룸
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 3, '한원장', 'OWNER', '010-2222-0006');
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 3, '오디자이너', 'MANAGER', '010-2222-0007');
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 3, '서디자이너', 'STAFF', '010-2222-0008');

-- 매장 4: 이탈리안 비스트로
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 4, '마르코', 'OWNER', '010-2222-0009');
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 4, '윤셰프', 'MANAGER', '010-2222-0010');

-- 매장 5: 바디핏 피트니스
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 5, '강트레이너', 'OWNER', '010-2222-0011');
INSERT INTO staff (staff_id, store_id, staff_name, staff_role, phone) VALUES (seq_staff.NEXTVAL, 5, '임트레이너', 'STAFF', '010-2222-0012');

-- ============================================================
-- 6. 서비스/메뉴 (services) - stores 의존
-- ============================================================

-- 매장 1: 맛있는 한식당
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 1, '점심 정식 A', '정식', 12000, 60, '된장찌개 + 불고기 + 밑반찬 5종');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 1, '점심 정식 B', '정식', 15000, 60, '갈비탕 + 전 + 밑반찬 5종');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 1, '저녁 한정식', '한정식', 35000, 90, '코스 한정식 (전채~후식)');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 1, '프리미엄 한우 코스', '특선', 65000, 120, '한우 등심 코스 (2인 이상)');

-- 매장 2: 카페 모닝글로리
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 2, '아메리카노', '커피', 4500, 30, '싱글 오리진 핸드드립 아메리카노');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 2, '카페라떼', '커피', 5500, 30, '부드러운 우유 라떼');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 2, '수제 케이크 세트', '디저트', 12000, 60, '음료 + 시즌 케이크');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 2, '브런치 세트', '브런치', 18000, 60, '파니니 + 샐러드 + 음료');

-- 매장 3: 헤어스튜디오 블룸
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 3, '여성 커트', '커트', 25000, 40, '샴푸 + 커트 + 드라이');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 3, '남성 커트', '커트', 18000, 30, '남성 전문 커트');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 3, '염색 (전체)', '컬러', 80000, 120, '전체 염색 (약제 포함)');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 3, '디지털 펌', '펌', 120000, 150, '볼륨 디지털 펌');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 3, '두피 클리닉', '클리닉', 50000, 60, '두피 진단 + 딥클렌징');

-- 매장 4: 이탈리안 비스트로
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 4, '마르게리타 피자', '피자', 16000, 60, '클래식 마르게리타');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 4, '까르보나라', '파스타', 15000, 60, '정통 로마식 까르보나라');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 4, '디너 코스 A', '코스', 45000, 90, '전채 + 파스타 + 메인 + 디저트');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 4, '와인 페어링', '음료', 30000, 90, '소믈리에 추천 와인 3잔');

-- 매장 5: 바디핏 피트니스
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 5, 'PT 1회', 'PT', 70000, 60, '1:1 개인 트레이닝');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 5, 'PT 10회 패키지', 'PT', 600000, 60, '1:1 PT 10회 (회당 6만원)');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 5, '체성분 분석', '분석', 10000, 20, '인바디 측정 + 상담');
INSERT INTO services (service_id, store_id, service_name, service_category, price, duration_min, description) VALUES (seq_services.NEXTVAL, 5, '그룹 필라테스', '그룹', 25000, 50, '소그룹 필라테스 (최대 5명)');

-- ============================================================
-- 7. 예약 (reservations) - stores, members, staff 의존
-- ============================================================

-- 완료된 예약들 (과거)
INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 1, 1, 2, TO_DATE('2025-12-20', 'YYYY-MM-DD'), '12:00', '13:00', 4, 'COMPLETED', '창가 자리 요청');

INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 1, 6, 2, TO_DATE('2025-12-22', 'YYYY-MM-DD'), '18:30', '20:00', 2, 'COMPLETED', '기념일 예약');

INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 3, 2, 7, TO_DATE('2025-12-23', 'YYYY-MM-DD'), '14:00', '16:30', 1, 'COMPLETED', '펌 + 염색 동시 시술');

INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 2, 5, 4, TO_DATE('2025-12-24', 'YYYY-MM-DD'), '10:00', '11:00', 3, 'COMPLETED', '크리스마스 이브 브런치');

INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 4, 3, 9, TO_DATE('2025-12-25', 'YYYY-MM-DD'), '19:00', '21:00', 2, 'COMPLETED', '크리스마스 디너');

-- 취소된 예약
INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, cancel_reason)
VALUES (seq_reservations.NEXTVAL, 1, 4, 2, TO_DATE('2025-12-28', 'YYYY-MM-DD'), '12:00', '13:00', 2, 'CANCELLED', '개인 사정으로 취소');

-- 노쇼
INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status)
VALUES (seq_reservations.NEXTVAL, 3, 7, 8, TO_DATE('2025-12-29', 'YYYY-MM-DD'), '11:00', '11:30', 1, 'NO_SHOW');

-- 확정된 예약 (미래)
INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 1, 1, 2, TO_DATE('2026-02-10', 'YYYY-MM-DD'), '18:00', '20:00', 6, 'CONFIRMED', '회식 예약 - 룸 요청');

INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 3, 5, 7, TO_DATE('2026-02-11', 'YYYY-MM-DD'), '15:00', '16:00', 1, 'CONFIRMED', '커트 + 두피 클리닉');

INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status)
VALUES (seq_reservations.NEXTVAL, 2, 8, 5, TO_DATE('2026-02-12', 'YYYY-MM-DD'), '09:00', '10:00', 2, 'CONFIRMED');

INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 4, 6, 10, TO_DATE('2026-02-14', 'YYYY-MM-DD'), '19:00', '21:00', 2, 'CONFIRMED', '발렌타인 데이 디너');

INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 5, 3, 11, TO_DATE('2026-02-15', 'YYYY-MM-DD'), '10:00', '11:00', 1, 'CONFIRMED', 'PT 체험');

-- 대기 상태 예약
INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status, memo)
VALUES (seq_reservations.NEXTVAL, 1, 2, NULL, TO_DATE('2026-02-10', 'YYYY-MM-DD'), '18:30', '20:00', 4, 'WAITING', '대기 예약 - 자리 나면 연락 요청');

INSERT INTO reservations (reservation_id, store_id, member_id, staff_id, reservation_date, start_time, end_time, party_size, status)
VALUES (seq_reservations.NEXTVAL, 4, 7, NULL, TO_DATE('2026-02-14', 'YYYY-MM-DD'), '19:00', '20:30', 2, 'WAITING');

-- ============================================================
-- 8. 예약별 서비스 (reservation_services) - reservations, services 의존
-- ============================================================

-- 예약 1: 한식당 점심 (김민수)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 1, 1, 2, 12000);
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 1, 2, 2, 15000);

-- 예약 2: 한식당 저녁 한정식 (한태영)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 2, 3, 2, 35000);

-- 예약 3: 미용실 펌+염색 (이서연)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 3, 11, 1, 80000);
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 3, 12, 1, 120000);

-- 예약 4: 카페 브런치 (정다은)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 4, 8, 3, 18000);

-- 예약 5: 이탈리안 디너 코스 (박준호)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 5, 16, 2, 45000);
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 5, 17, 1, 30000);

-- 예약 8: 한식당 회식 (김민수 - 미래)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 8, 3, 4, 35000);
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 8, 4, 2, 65000);

-- 예약 9: 미용실 커트+클리닉 (정다은 - 미래)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 9, 9, 1, 25000);
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 9, 13, 1, 50000);

-- 예약 10: 카페 브런치 (윤성호 - 미래)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 10, 8, 2, 18000);

-- 예약 11: 이탈리안 디너 (한태영 - 발렌타인)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 11, 16, 2, 45000);
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 11, 17, 1, 30000);

-- 예약 12: 피트니스 PT (박준호 - 미래)
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 12, 18, 1, 70000);
INSERT INTO reservation_services (rsv_service_id, reservation_id, service_id, quantity, unit_price) VALUES (seq_reservation_services.NEXTVAL, 12, 20, 1, 10000);

-- ============================================================
-- 9. 리뷰 (reviews) - reservations, members, stores 의존
--    완료된 예약(1~5)에 대해서만 리뷰 작성
-- ============================================================

INSERT INTO reviews (review_id, reservation_id, member_id, store_id, rating, content)
VALUES (seq_reviews.NEXTVAL, 1, 1, 1, 5, '한정식이 정말 맛있었습니다. 반찬도 정갈하고 서비스도 친절해요.');

INSERT INTO reviews (review_id, reservation_id, member_id, store_id, rating, content)
VALUES (seq_reviews.NEXTVAL, 2, 6, 1, 4, '기념일에 방문했는데 분위기 좋았습니다. 다만 대기가 조금 있었어요.');

INSERT INTO reviews (review_id, reservation_id, member_id, store_id, rating, content)
VALUES (seq_reviews.NEXTVAL, 3, 2, 3, 5, '디자이너님이 원하는 스타일을 정확히 잡아주셨어요. 펌도 자연스럽게 잘 나왔습니다.');

INSERT INTO reviews (review_id, reservation_id, member_id, store_id, rating, content)
VALUES (seq_reviews.NEXTVAL, 4, 5, 2, 4, '브런치 맛있었고 분위기도 좋아요. 다만 주말이라 좀 시끄러웠습니다.');

INSERT INTO reviews (review_id, reservation_id, member_id, store_id, rating, content)
VALUES (seq_reviews.NEXTVAL, 5, 3, 4, 5, '크리스마스 분위기에 정통 이탈리안 코스를 즐겼습니다. 와인 페어링도 훌륭!');

-- ============================================================
-- 10. 결제 (payments) - reservations 의존
-- ============================================================

-- 예약 1: 한식당 점심 (정식A 2 + 정식B 2 = 54,000)
INSERT INTO payments (payment_id, reservation_id, amount, payment_method, payment_status, paid_at)
VALUES (seq_payments.NEXTVAL, 1, 54000, 'CARD', 'PAID', TO_TIMESTAMP_TZ('2025-12-20 13:10:00 +09:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM'));

-- 예약 2: 한식당 한정식 (35,000 x 2 = 70,000)
INSERT INTO payments (payment_id, reservation_id, amount, payment_method, payment_status, paid_at)
VALUES (seq_payments.NEXTVAL, 2, 70000, 'CARD', 'PAID', TO_TIMESTAMP_TZ('2025-12-22 20:15:00 +09:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM'));

-- 예약 3: 미용실 펌+염색 (80,000 + 120,000 = 200,000)
INSERT INTO payments (payment_id, reservation_id, amount, payment_method, payment_status, paid_at)
VALUES (seq_payments.NEXTVAL, 3, 200000, 'CARD', 'PAID', TO_TIMESTAMP_TZ('2025-12-23 16:30:00 +09:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM'));

-- 예약 4: 카페 브런치 (18,000 x 3 = 54,000)
INSERT INTO payments (payment_id, reservation_id, amount, payment_method, payment_status, paid_at)
VALUES (seq_payments.NEXTVAL, 4, 54000, 'CASH', 'PAID', TO_TIMESTAMP_TZ('2025-12-24 11:00:00 +09:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM'));

-- 예약 5: 이탈리안 디너코스+와인 (45,000 x 2 + 30,000 = 120,000)
INSERT INTO payments (payment_id, reservation_id, amount, payment_method, payment_status, paid_at)
VALUES (seq_payments.NEXTVAL, 5, 120000, 'CARD', 'PAID', TO_TIMESTAMP_TZ('2025-12-25 21:10:00 +09:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM'));

-- 예약 6: 취소 환불
INSERT INTO payments (payment_id, reservation_id, amount, payment_method, payment_status, paid_at, refund_amount, refunded_at)
VALUES (seq_payments.NEXTVAL, 6, 24000, 'CARD', 'REFUNDED', TO_TIMESTAMP_TZ('2025-12-26 10:00:00 +09:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM'), 24000, TO_TIMESTAMP_TZ('2025-12-28 09:00:00 +09:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM'));

-- ============================================================
-- 11. 알림 로그 (notification_log) - reservations, members 의존
-- ============================================================

-- 예약 확인 알림
INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, 1, 1, 'CONFIRM', 'KAKAO', '예약 확인', '[맛있는 한식당] 12/20(금) 12:00 4명 예약이 확정되었습니다.');

INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, 2, 6, 'CONFIRM', 'KAKAO', '예약 확인', '[맛있는 한식당] 12/22(일) 18:30 2명 예약이 확정되었습니다.');

INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, 3, 2, 'CONFIRM', 'SMS', '예약 확인', '[헤어스튜디오 블룸] 12/23(월) 14:00 예약 확정');

-- 리마인드 알림
INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, 1, 1, 'REMIND', 'KAKAO', '방문 리마인드', '[맛있는 한식당] 내일 12:00 예약이 있습니다. 변경/취소는 매장에 연락해 주세요.');

INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, 8, 1, 'CONFIRM', 'KAKAO', '예약 확인', '[맛있는 한식당] 2/10(월) 18:00 6명 예약이 확정되었습니다.');

-- 리뷰 요청 알림
INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, 1, 1, 'REVIEW_REQUEST', 'PUSH', '리뷰 작성', '맛있는 한식당 방문은 어떠셨나요? 리뷰를 남겨주세요!');

INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, 5, 3, 'REVIEW_REQUEST', 'PUSH', '리뷰 작성', '이탈리안 비스트로 방문은 어떠셨나요? 리뷰를 남겨주세요!');

-- 취소 알림
INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, 6, 4, 'CANCEL', 'KAKAO', '예약 취소', '[맛있는 한식당] 12/28(토) 12:00 예약이 취소되었습니다.');

-- 프로모션 알림 (예약 무관)
INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, NULL, 1, 'PROMOTION', 'EMAIL', '2월 특별 할인', 'VIP 회원님을 위한 2월 한정 10% 할인 쿠폰을 드립니다.');

INSERT INTO notification_log (log_id, reservation_id, member_id, noti_type, noti_channel, title, content)
VALUES (seq_notification_log.NEXTVAL, NULL, 6, 'PROMOTION', 'EMAIL', '2월 특별 할인', 'VIP 회원님을 위한 2월 한정 10% 할인 쿠폰을 드립니다.');

-- ============================================================
-- COMMIT
-- ============================================================
COMMIT;
