/**
 * prompt-builder.ts 유닛 테스트
 *
 * buildTableSelectionPrompt, parseSelectedTables 함수 테스트
 */

import { buildTableSelectionPrompt, parseSelectedTables, buildPrompt } from '../../src/ai/prompt-builder.js';
import type { SchemaInfo } from '../../src/database/schema-extractor.js';
import type {
  GlossaryTerm,
  GlossaryAlias,
  TableRelationship,
  QueryPattern,
  PatternKeyword,
} from '../../src/database/metadata/types.js';

describe('buildTableSelectionPrompt', () => {
  const tableSummary = 'public.customers -- 고객 마스터\npublic.orders -- 주문\npublic.products -- 상품';

  const glossaryTerms: GlossaryTerm[] = [
    {
      termCode: 'VIP',
      term: 'VIP고객',
      category: 'BUSINESS',
      sqlCondition: "grade = 'VIP'",
      applyToTables: ['customers'],
      priority: 1,
    },
  ];

  const glossaryAliases: GlossaryAlias[] = [
    { termCode: 'VIP', alias: '우수고객', matchType: 'EXACT' },
  ];

  it('should include table summary in prompt', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, [], [], [], 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('customers -- 고객 마스터');
    expect(result).toContain('orders -- 주문');
  });

  it('should include glossary terms', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, [], [], [], 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('VIP고객');
    expect(result).toContain("grade = 'VIP'");
  });

  it('should include glossary aliases', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, [], [], [], 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('우수고객');
  });

  it('should include user query', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, [], [], [], 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('VIP고객정보를 조회해줘');
  });
});

describe('buildTableSelectionPrompt with relationships', () => {
  const tableSummary = 'public.orders -- 주문\npublic.customers -- 고객';
  const relationships: TableRelationship[] = [
    {
      sourceSchema: 'public',
      sourceTable: 'orders',
      sourceColumn: 'customer_id',
      targetSchema: 'public',
      targetTable: 'customers',
      targetColumn: 'id',
      relationshipType: 'MANY_TO_ONE',
      confidence: 'HIGH',
    },
  ];

  it('should include relationship info when provided', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], relationships, [], [], '주문한 고객 목록'
    );
    expect(result).toContain('orders.customer_id');
    expect(result).toContain('customers.id');
  });

  it('should include Table Relationships section header', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], relationships, [], [], '주문한 고객 목록'
    );
    expect(result).toContain('Table Relationships');
  });

  it('should skip relationships section when empty', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], [], [], [], '주문 목록'
    );
    expect(result).not.toContain('Table Relationships');
  });
});

describe('buildTableSelectionPrompt with queryPattern hints', () => {
  const tableSummary = 'public.orders -- 주문';
  const queryPatterns: QueryPattern[] = [
    {
      patternCode: 'monthly_agg',
      patternName: 'Monthly Aggregation',
      category: 'AGGREGATION',
      sqlTemplate: 'SELECT ...',
      applicableTables: ['orders', 'order_items'],
      matchScoreThreshold: 70,
      priority: 100,
    },
  ];
  const patternKeywords: PatternKeyword[] = [
    {
      patternCode: 'monthly_agg',
      keyword: '월별',
      weight: 10,
      matchType: 'CONTAINS',
      isRequired: false,
    },
  ];

  it('should include query pattern table hints', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], [], queryPatterns, patternKeywords, '월별 매출'
    );
    expect(result).toContain('Monthly Aggregation');
    expect(result).toContain('orders');
  });

  it('should include pattern keywords with table hints', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], [], queryPatterns, patternKeywords, '월별 매출'
    );
    expect(result).toContain('월별');
  });

  it('should skip pattern hints when queryPatterns have no applicableTables', () => {
    const patternsNoTables: QueryPattern[] = [
      {
        patternCode: 'generic',
        patternName: 'Generic Pattern',
        category: 'CUSTOM',
        sqlTemplate: 'SELECT ...',
        applicableTables: [],
        matchScoreThreshold: 70,
        priority: 100,
      },
    ];
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], [], patternsNoTables, [], '테스트'
    );
    expect(result).not.toContain('Query Pattern Table Hints');
  });
});

describe('parseSelectedTables', () => {
  it('should parse clean JSON array', () => {
    const result = parseSelectedTables('["customers", "orders"]');
    expect(result).toEqual(['customers', 'orders']);
  });

  it('should parse JSON wrapped in markdown code block', () => {
    const result = parseSelectedTables('```json\n["customers", "orders"]\n```');
    expect(result).toEqual(['customers', 'orders']);
  });

  it('should handle extra whitespace', () => {
    const result = parseSelectedTables('  ["customers",  "orders"]  ');
    expect(result).toEqual(['customers', 'orders']);
  });

  it('should return empty array for invalid JSON', () => {
    const result = parseSelectedTables('not valid json');
    expect(result).toEqual([]);
  });

  it('should handle LLM response with explanation text around JSON', () => {
    const response = 'Based on the query, the relevant tables are:\n["customers", "vip_benefits"]\nThese tables contain...';
    const result = parseSelectedTables(response);
    expect(result).toEqual(['customers', 'vip_benefits']);
  });
});

describe('buildPrompt', () => {
  const mockSchema: SchemaInfo = {
    tables: [{
      name: 'customers',
      schema: 'public',
      comment: '고객',
      columns: [{ name: 'cust_name', type: 'VARCHAR2(100)', nullable: false, comment: '고객명', isPrimaryKey: false, isForeignKey: false }],
      indexes: [],
    }],
    recentQueries: [],
  };

  it('should include database type in prompt', () => {
    const result = buildPrompt({
      tables: mockSchema,
      naturalLanguageQuery: '고객 목록 조회',
      dbType: 'oracle',
    });
    expect(result).toContain('Database type: ORACLE');
  });

  it('should include charset info when oracleDataCharset is provided', () => {
    const result = buildPrompt({
      tables: mockSchema,
      naturalLanguageQuery: '고객 목록 조회',
      dbType: 'oracle',
      oracleDataCharset: 'ms949',
    });
    expect(result).toContain('data charset: ms949');
    expect(result).not.toContain('UTL_RAW.CAST_TO_RAW');
  });

  it('should NOT include charset info when oracleDataCharset is not provided', () => {
    const result = buildPrompt({
      tables: mockSchema,
      naturalLanguageQuery: '고객 목록 조회',
      dbType: 'oracle',
    });
    expect(result).not.toContain('UTL_RAW.CAST_TO_RAW');
  });

  it('should NOT include UTL_RAW hint for non-oracle databases', () => {
    const result = buildPrompt({
      tables: mockSchema,
      naturalLanguageQuery: '고객 목록 조회',
      dbType: 'postgresql',
    });
    expect(result).not.toContain('UTL_RAW');
  });
});

describe('buildPrompt - oracle charset UTL_RAW behavior', () => {
  const schema: SchemaInfo = {
    tables: [
      {
        name: 'customers',
        columns: [
          { name: 'customer_name', type: 'VARCHAR2(100)', nullable: true, comment: '고객명' },
          { name: 'id', type: 'NUMBER', nullable: false, comment: 'ID' },
        ],
        constraints: [],
        indexes: [],
      },
    ],
  };

  it('should NOT include UTL_RAW instruction when oracleDataCharset is set (prompt is always UTL_RAW-free)', () => {
    const prompt = buildPrompt({
      tables: schema,
      naturalLanguageQuery: '고객 이름 조회',
      dbType: 'oracle',
      oracleDataCharset: 'ms949',
    });
    expect(prompt).not.toContain('UTL_RAW.CAST_TO_RAW');
    expect(prompt).not.toContain('ALWAYS wrap');
  });

  it('should still include charset info in dbType label when oracleDataCharset is set', () => {
    const prompt = buildPrompt({
      tables: schema,
      naturalLanguageQuery: '고객 이름 조회',
      dbType: 'oracle',
      oracleDataCharset: 'ms949',
    });
    expect(prompt).toContain('ms949');
  });
});
