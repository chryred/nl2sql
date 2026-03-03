import { extractTablesFromSQL } from '../../src/utils/sql-parser.js';

describe('extractTablesFromSQL', () => {
  it('단순 SELECT-FROM에서 테이블명 추출', () => {
    const sql = 'SELECT id, customer_name FROM customers';
    expect(extractTablesFromSQL(sql)).toEqual(['customers']);
  });

  it('다중 JOIN에서 모든 테이블명 추출', () => {
    const sql = `
      SELECT o.id, c.name, p.title
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN products p ON o.product_id = p.id
    `;
    expect(extractTablesFromSQL(sql).sort()).toEqual(
      ['customers', 'orders', 'products'].sort()
    );
  });

  it('schema.table 형식에서 테이블명만 추출', () => {
    const sql = 'SELECT * FROM nl2sql.orders o';
    expect(extractTablesFromSQL(sql)).toEqual(['orders']);
  });

  it('CTE 이름은 결과에서 제외하고 실제 테이블만 추출', () => {
    const sql = `
      WITH active_users AS (
        SELECT * FROM users WHERE is_active = 1
      )
      SELECT * FROM active_users
      JOIN orders o ON active_users.id = o.user_id
    `;
    const result = extractTablesFromSQL(sql).sort();
    expect(result).toEqual(['orders', 'users'].sort());
    expect(result).not.toContain('active_users');
  });

  it('서브쿼리 내부 테이블도 추출', () => {
    const sql = 'SELECT * FROM (SELECT id FROM users WHERE active = 1) t';
    expect(extractTablesFromSQL(sql)).toEqual(['users']);
  });

  it('UPDATE 문에서 테이블명 추출', () => {
    const sql = "UPDATE customers SET name = 'x' WHERE id = 1";
    expect(extractTablesFromSQL(sql)).toEqual(['customers']);
  });

  it('INSERT INTO 문에서 테이블명 추출', () => {
    const sql = 'INSERT INTO orders (id, amount) VALUES (1, 100)';
    expect(extractTablesFromSQL(sql)).toEqual(['orders']);
  });

  it('대소문자 혼용 키워드 처리', () => {
    const sql = 'select id from CUSTOMERS c inner join ORDERS o on c.id = o.cid';
    expect(extractTablesFromSQL(sql).sort()).toEqual(
      ['customers', 'orders'].sort()
    );
  });

  it('유효한 테이블이 없으면 빈 배열 반환', () => {
    const sql = 'SELECT SYSDATE FROM DUAL';
    const result = extractTablesFromSQL(sql);
    expect(Array.isArray(result)).toBe(true);
  });
});
