/**
 * query-pattern-manage.ts 유닛 테스트
 *
 * buildPatternCode, parseKeywordsResult 함수 테스트
 */

import { buildPatternCode, parseKeywordsResult } from '../../src/mcp/tools/query-pattern-manage.js';

describe('buildPatternCode', () => {
  it('should produce snake_case with 4-char hex suffix', () => {
    const code = buildPatternCode('월별 매출 집계');
    expect(code).toMatch(/^[a-z0-9_]+_[0-9a-f]{4}$/);
  });

  it('should handle English names', () => {
    const code = buildPatternCode('Monthly Sales Report');
    expect(code).toMatch(/^monthly_sales_report_[0-9a-f]{4}$/);
  });

  it('should be lowercase', () => {
    const code = buildPatternCode('TOP Sales');
    expect(code).toMatch(/^top_sales_[0-9a-f]{4}$/);
  });

  it('should collapse multiple spaces/special chars into single underscore', () => {
    const code = buildPatternCode('Order  --  Summary');
    expect(code).toMatch(/^order_summary_[0-9a-f]{4}$/);
  });

  it('should not start or end with underscore (before suffix)', () => {
    const code = buildPatternCode('Monthly Report');
    const base = code.slice(0, code.lastIndexOf('_'));
    expect(base).not.toMatch(/^_|_$/);
  });
});

describe('parseKeywordsResult', () => {
  it('should parse PostgreSQL array string {a,b,c}', () => {
    const result = parseKeywordsResult('{월별,monthly,매출}');
    expect(result).toEqual(['월별', 'monthly', '매출']);
  });

  it('should parse MySQL GROUP_CONCAT CSV string', () => {
    const result = parseKeywordsResult('월별,monthly,매출');
    expect(result).toEqual(['월별', 'monthly', '매출']);
  });

  it('should parse already-parsed array (PostgreSQL driver)', () => {
    const result = parseKeywordsResult(['월별', 'monthly']);
    expect(result).toEqual(['월별', 'monthly']);
  });

  it('should return empty array for null', () => {
    expect(parseKeywordsResult(null)).toEqual([]);
  });

  it('should return empty array for undefined', () => {
    expect(parseKeywordsResult(undefined)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(parseKeywordsResult('')).toEqual([]);
  });

  it('should return empty array for empty PG array string', () => {
    expect(parseKeywordsResult('{}')).toEqual([]);
  });
});
