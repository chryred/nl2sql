import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/logger/index.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/database/charset-converter.js', () => ({
  encodeForOracle: jest.fn((value: string) => {
    if (value === '한글') return 'HEXENCODED';
    return value;
  }),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
let filterMissingComments: any;
let buildCommentPrompt: any;
let parseCommentResponse: any;
let truncateComment: any;
let buildCommentSQL: any;
let formatAutoCommentResult: any;

describe('comment-generator', () => {
  beforeAll(async () => {
    const gen = await import('../../src/database/comment-generator.js');
    filterMissingComments = gen.filterMissingComments;
    buildCommentPrompt = gen.buildCommentPrompt;
    parseCommentResponse = gen.parseCommentResponse;
    truncateComment = gen.truncateComment;
    buildCommentSQL = gen.buildCommentSQL;

    const autoComments = await import('../../src/mcp/tools/auto-comments.js');
    formatAutoCommentResult = autoComments.formatAutoCommentResult;
  });

  describe('filterMissingComments', () => {
    it('should include tables and columns with null/empty comments', () => {
      const schema = {
        tables: [
          {
            name: 'users',
            schemaName: 'public',
            comment: null,
            columns: [
              {
                name: 'id',
                type: 'int',
                nullable: false,
                isPrimaryKey: true,
                comment: null,
              },
              {
                name: 'name',
                type: 'varchar',
                nullable: true,
                isPrimaryKey: false,
                comment: '',
              },
            ],
          },
        ],
      };
      const result = filterMissingComments(schema as any);
      expect(result.length).toBe(3);
      expect(result.some((t: any) => t.table === 'users' && !t.column)).toBe(
        true
      );
      expect(result.some((t: any) => t.column === 'id')).toBe(true);
      expect(result.some((t: any) => t.column === 'name')).toBe(true);
    });

    it('should exclude tables and columns that already have comments', () => {
      const schema = {
        tables: [
          {
            name: 'orders',
            schemaName: 'public',
            comment: '주문 테이블',
            columns: [
              {
                name: 'id',
                type: 'int',
                nullable: false,
                isPrimaryKey: true,
                comment: 'Primary key',
              },
            ],
          },
        ],
      };
      const result = filterMissingComments(schema as any);
      expect(result.length).toBe(0);
    });

    it('should exclude nl2sql metadata tables', () => {
      const schema = {
        tables: [
          {
            name: 'table_relationships',
            schemaName: 'public',
            comment: null,
            columns: [],
          },
          {
            name: 'glossary_terms',
            schemaName: 'public',
            comment: null,
            columns: [],
          },
        ],
      };
      const result = filterMissingComments(schema as any);
      expect(result.length).toBe(0);
    });

    it('should apply schema filter', () => {
      const schema = {
        tables: [
          {
            name: 'users',
            schemaName: 'public',
            comment: null,
            columns: [],
          },
          {
            name: 'products',
            schemaName: 'shop',
            comment: null,
            columns: [],
          },
        ],
      };
      const result = filterMissingComments(schema as any, { schema: 'public' });
      expect(result.length).toBe(1);
      expect(result[0].schema).toBe('public');
    });

    it('should apply tables filter', () => {
      const schema = {
        tables: [
          {
            name: 'users',
            schemaName: 'public',
            comment: null,
            columns: [],
          },
          {
            name: 'products',
            schemaName: 'public',
            comment: null,
            columns: [],
          },
        ],
      };
      const result = filterMissingComments(schema as any, {
        tables: ['users'],
      });
      expect(result.length).toBe(1);
      expect(result[0].table).toBe('users');
    });
  });

  describe('buildCommentPrompt', () => {
    it('should include table name, column name, data type, PK/FK info', () => {
      const targets = [
        {
          schema: 'public',
          table: 'orders',
          column: undefined,
        },
        {
          schema: 'public',
          table: 'orders',
          column: 'user_id',
          dataType: 'int',
          isPrimaryKey: false,
          foreignKey: { refTable: 'users', refColumn: 'id' },
        },
      ];
      const prompt = buildCommentPrompt(targets, null, 'postgresql');
      expect(prompt).toContain('orders');
      expect(prompt).toContain('user_id');
      expect(prompt).toContain('int');
      expect(prompt).toContain('FK');
      expect(prompt).toContain('users');
    });

    it('should include glossary terms when metadata is provided', () => {
      const targets = [
        { schema: 'public', table: 'orders', column: undefined },
      ];
      const metadata = {
        glossaryTerms: [{ term: 'order', definition: '고객 주문 정보' }],
      };
      const prompt = buildCommentPrompt(targets, metadata as any, 'postgresql');
      expect(prompt).toContain('order');
      expect(prompt).toContain('고객 주문 정보');
    });
  });

  describe('parseCommentResponse', () => {
    it('should parse valid JSON array', () => {
      const response = JSON.stringify([
        {
          schema: 'public',
          table: 'users',
          column: null,
          comment: '사용자 테이블',
        },
        { schema: 'public', table: 'users', column: 'id', comment: '기본키' },
      ]);
      const result = parseCommentResponse(response);
      expect(result.length).toBe(2);
      expect(result[0].comment).toBe('사용자 테이블');
      expect(result[1].column).toBe('id');
    });

    it('should return empty array for invalid JSON', () => {
      const result = parseCommentResponse('not valid json at all');
      expect(result).toEqual([]);
    });

    it('should skip items missing required fields', () => {
      const response = JSON.stringify([
        { schema: 'public', table: 'users', column: null, comment: 'valid' },
        { table: 'users', column: null, comment: 'missing schema' },
        { schema: 'public', table: 'users', column: null },
      ]);
      const result = parseCommentResponse(response);
      expect(result.length).toBe(1);
      expect(result[0].comment).toBe('valid');
    });

    it('should handle markdown code block wrapping', () => {
      const response =
        '```json\n[{"schema":"public","table":"t","column":null,"comment":"test"}]\n```';
      const result = parseCommentResponse(response);
      expect(result.length).toBe(1);
      expect(result[0].comment).toBe('test');
    });
  });

  describe('truncateComment', () => {
    it('should not truncate PostgreSQL comments', () => {
      const longComment = 'a'.repeat(5000);
      const result = truncateComment(longComment, 'postgresql', true);
      expect(result.truncated).toBe(false);
      expect(result.text.length).toBe(5000);
    });

    it('should truncate MySQL column comments at 1024 chars', () => {
      const longComment = 'a'.repeat(2000);
      const result = truncateComment(longComment, 'mysql', false);
      expect(result.truncated).toBe(true);
      expect(result.text.length).toBe(1024);
    });

    it('should truncate MySQL table comments at 2048 chars', () => {
      const longComment = 'a'.repeat(3000);
      const result = truncateComment(longComment, 'mysql', true);
      expect(result.truncated).toBe(true);
      expect(result.text.length).toBe(2048);
    });

    it('should truncate Oracle comments at 4000 bytes', () => {
      const longComment = 'a'.repeat(5000);
      const result = truncateComment(longComment, 'oracle', true);
      expect(result.truncated).toBe(true);
      expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(4000);
    });
  });

  describe('buildCommentSQL', () => {
    it('should generate PostgreSQL COMMENT ON TABLE', () => {
      const candidate = {
        schema: 'public',
        table: 'users',
        column: null,
        comment: '사용자 테이블',
      };
      const { sql, bindings } = buildCommentSQL(candidate, 'postgresql');
      expect(sql).toContain('COMMENT ON TABLE');
      expect(sql).toContain('"public"."users"');
      expect(sql).toContain('IS ?');
      expect(bindings).toEqual(['사용자 테이블']);
    });

    it('should generate PostgreSQL COMMENT ON COLUMN', () => {
      const candidate = {
        schema: 'public',
        table: 'users',
        column: 'id',
        comment: '기본키',
      };
      const { sql, bindings } = buildCommentSQL(candidate, 'postgresql');
      expect(sql).toContain('COMMENT ON COLUMN');
      expect(sql).toContain('"public"."users"."id"');
      expect(bindings).toEqual(['기본키']);
    });

    it('should generate MySQL ALTER TABLE COMMENT for table', () => {
      const candidate = {
        schema: 'mydb',
        table: 'orders',
        column: null,
        comment: '주문 테이블',
      };
      const { sql, bindings } = buildCommentSQL(candidate, 'mysql');
      expect(sql).toContain('ALTER TABLE');
      expect(sql).toContain('`mydb`.`orders`');
      expect(sql).toContain('COMMENT = ?');
      expect(bindings).toEqual(['주문 테이블']);
    });

    it('should generate MySQL MODIFY COLUMN with full column def', () => {
      const candidate = {
        schema: 'mydb',
        table: 'users',
        column: 'name',
        comment: '사용자명',
      };
      const mysqlColDef = {
        columnType: 'varchar(255)',
        isNullable: 'NO',
        columnDefault: null,
        extra: '',
      };
      const { sql, bindings } = buildCommentSQL(
        candidate,
        'mysql',
        undefined,
        mysqlColDef
      );
      expect(sql).toContain('MODIFY COLUMN');
      expect(sql).toContain('`name`');
      expect(sql).toContain('varchar(255)');
      expect(sql).toContain('NOT NULL');
      expect(sql).toContain('COMMENT ?');
      expect(bindings).toEqual(['사용자명']);
    });

    it('should generate Oracle COMMENT ON TABLE (no charset)', () => {
      const candidate = {
        schema: 'myschema',
        table: 'orders',
        column: null,
        comment: 'Order table',
      };
      const { sql, bindings } = buildCommentSQL(candidate, 'oracle');
      expect(sql).toContain('COMMENT ON TABLE');
      expect(sql).toContain('"MYSCHEMA"."ORDERS"');
      expect(sql).toContain('IS ?');
      expect(bindings).toEqual(['Order table']);
    });

    it('should generate Oracle PL/SQL block with UTL_RAW when charset set', () => {
      const candidate = {
        schema: 'myschema',
        table: 'orders',
        column: null,
        comment: '한글',
      };
      const { sql, bindings } = buildCommentSQL(candidate, 'oracle', 'ms949');
      expect(sql).toContain('EXECUTE IMMEDIATE');
      expect(sql).toContain('UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(?))');
      expect(bindings).toEqual(['HEXENCODED']);
    });
  });

  describe('formatAutoCommentResult', () => {
    it('should format preview result with table and column sections', () => {
      const result = {
        candidates: [
          {
            schema: 'public',
            table: 'users',
            column: null,
            comment: '사용자 테이블',
          },
          { schema: 'public', table: 'users', column: 'id', comment: '기본키' },
        ],
      };
      const text = formatAutoCommentResult(result as any);
      expect(text).toContain('Table Comments');
      expect(text).toContain('Column Comments');
      expect(text).toContain('사용자 테이블');
      expect(text).toContain('기본키');
    });

    it('should show Applied/Skipped/Failed in apply mode result', () => {
      const result = {
        candidates: [
          {
            schema: 'public',
            table: 'users',
            column: null,
            comment: '사용자 테이블',
          },
        ],
        applied: 1,
        skipped: 0,
        failed: 0,
      };
      const text = formatAutoCommentResult(result as any);
      expect(text).toContain('Applied: 1');
      expect(text).toContain('Skipped: 0');
      expect(text).toContain('Failed: 0');
    });

    it('should mark truncated comments with [TRUNCATED]', () => {
      const result = {
        candidates: [
          {
            schema: 'public',
            table: 'users',
            column: null,
            comment: 'short',
            truncated: true,
          },
        ],
      };
      const text = formatAutoCommentResult(result as any);
      expect(text).toContain('[TRUNCATED]');
    });

    it('should return no candidates message when empty', () => {
      const result = { candidates: [] };
      const text = formatAutoCommentResult(result as any);
      expect(text).toContain('No comment candidates found');
    });
  });
});
