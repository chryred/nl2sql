import { nl2sqlSchemaInputSchema } from '../../src/mcp/tools/nl2sql-schema.js';

describe('nl2sqlSchemaInputSchema', () => {
  it('tables만 제공해도 유효하다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({ tables: ['users'] });
    expect(result.success).toBe(true);
  });

  it('query만 제공해도 유효하다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({ query: 'vip그룹고객조회' });
    expect(result.success).toBe(true);
  });

  it('tables와 query 모두 없으면 유효하지 않다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('tables가 빈 배열이고 query도 없으면 유효하지 않다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({ tables: [] });
    expect(result.success).toBe(false);
  });

  it('tables와 query 모두 제공해도 유효하다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({
      tables: ['users'],
      query: '사용자 조회',
    });
    expect(result.success).toBe(true);
  });
});
