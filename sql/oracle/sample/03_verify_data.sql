-- ============================================================
-- 매장예약시스템 데이터 검증 쿼리
-- ============================================================

-- 1. 테이블별 건수 확인
SELECT 'common_codes' AS table_name, COUNT(*) AS cnt FROM common_codes
UNION ALL SELECT 'stores', COUNT(*) FROM stores
UNION ALL SELECT 'store_hours', COUNT(*) FROM store_hours
UNION ALL SELECT 'members', COUNT(*) FROM members
UNION ALL SELECT 'staff', COUNT(*) FROM staff
UNION ALL SELECT 'services', COUNT(*) FROM services
UNION ALL SELECT 'reservations', COUNT(*) FROM reservations
UNION ALL SELECT 'reservation_services', COUNT(*) FROM reservation_services
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'payments', COUNT(*) FROM payments
UNION ALL SELECT 'notification_log', COUNT(*) FROM notification_log
ORDER BY 1;

-- 2. 매장별 예약 현황
SELECT s.store_name,
       COUNT(r.reservation_id) AS total_reservations,
       SUM(CASE WHEN r.status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
       SUM(CASE WHEN r.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN r.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
       SUM(CASE WHEN r.status = 'NO_SHOW' THEN 1 ELSE 0 END) AS no_show,
       SUM(CASE WHEN r.status = 'WAITING' THEN 1 ELSE 0 END) AS waiting
FROM stores s
LEFT JOIN reservations r ON s.store_id = r.store_id
GROUP BY s.store_name
ORDER BY total_reservations DESC;

-- 3. 회원등급별 예약 통계
SELECT m.member_grade,
       COUNT(DISTINCT m.member_id) AS member_count,
       COUNT(r.reservation_id) AS total_reservations,
       NVL(SUM(p.amount - p.refund_amount), 0) AS total_revenue
FROM members m
LEFT JOIN reservations r ON m.member_id = r.member_id
LEFT JOIN payments p ON r.reservation_id = p.reservation_id
GROUP BY m.member_grade
ORDER BY total_revenue DESC;

-- 4. 매장별 평균 평점
SELECT s.store_name,
       s.store_type,
       COUNT(rv.review_id) AS review_count,
       ROUND(AVG(rv.rating), 1) AS avg_rating
FROM stores s
LEFT JOIN reviews rv ON s.store_id = rv.store_id
GROUP BY s.store_name, s.store_type
ORDER BY avg_rating DESC NULLS LAST;

-- 5. 매장별 매출 집계
SELECT s.store_name,
       COUNT(DISTINCT r.reservation_id) AS paid_reservations,
       SUM(p.amount) AS total_sales,
       SUM(p.refund_amount) AS total_refunds,
       SUM(p.amount - p.refund_amount) AS net_revenue
FROM stores s
JOIN reservations r ON s.store_id = r.store_id
JOIN payments p ON r.reservation_id = p.reservation_id
GROUP BY s.store_name
ORDER BY net_revenue DESC;

-- 6. FK 무결성 검증 (결과가 0건이면 정상)
SELECT 'store_hours→stores' AS fk_check, COUNT(*) AS orphan_count FROM store_hours sh WHERE NOT EXISTS (SELECT 1 FROM stores s WHERE s.store_id = sh.store_id)
UNION ALL SELECT 'staff→stores', COUNT(*) FROM staff st WHERE NOT EXISTS (SELECT 1 FROM stores s WHERE s.store_id = st.store_id)
UNION ALL SELECT 'services→stores', COUNT(*) FROM services sv WHERE NOT EXISTS (SELECT 1 FROM stores s WHERE s.store_id = sv.store_id)
UNION ALL SELECT 'reservations→stores', COUNT(*) FROM reservations r WHERE NOT EXISTS (SELECT 1 FROM stores s WHERE s.store_id = r.store_id)
UNION ALL SELECT 'reservations→members', COUNT(*) FROM reservations r WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.member_id = r.member_id)
UNION ALL SELECT 'reservations→staff', COUNT(*) FROM reservations r WHERE r.staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff st WHERE st.staff_id = r.staff_id)
UNION ALL SELECT 'rsv_services→reservations', COUNT(*) FROM reservation_services rs WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.reservation_id = rs.reservation_id)
UNION ALL SELECT 'rsv_services→services', COUNT(*) FROM reservation_services rs WHERE NOT EXISTS (SELECT 1 FROM services sv WHERE sv.service_id = rs.service_id)
UNION ALL SELECT 'reviews→reservations', COUNT(*) FROM reviews rv WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.reservation_id = rv.reservation_id)
UNION ALL SELECT 'reviews→members', COUNT(*) FROM reviews rv WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.member_id = rv.member_id)
UNION ALL SELECT 'payments→reservations', COUNT(*) FROM payments p WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.reservation_id = p.reservation_id)
UNION ALL SELECT 'noti_log→reservations', COUNT(*) FROM notification_log nl WHERE nl.reservation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.reservation_id = nl.reservation_id)
UNION ALL SELECT 'noti_log→members', COUNT(*) FROM notification_log nl WHERE nl.member_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members m WHERE m.member_id = nl.member_id);
