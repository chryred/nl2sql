/**
 * prompt-builder.ts 유닛 테스트
 *
 * buildTableSelectionPrompt, parseSelectedTables 함수 테스트
 */

import { buildTableSelectionPrompt, parseSelectedTables } from '../../src/ai/prompt-builder.js';
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
