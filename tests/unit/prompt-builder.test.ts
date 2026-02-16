/**
 * prompt-builder.ts 유닛 테스트
 *
 * buildTableSelectionPrompt, parseSelectedTables 함수 테스트
 */

import { buildTableSelectionPrompt, parseSelectedTables } from '../../src/ai/prompt-builder.js';
import type { GlossaryTerm, GlossaryAlias } from '../../src/database/metadata/types.js';

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
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('customers -- 고객 마스터');
    expect(result).toContain('orders -- 주문');
  });

  it('should include glossary terms', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('VIP고객');
    expect(result).toContain("grade = 'VIP'");
  });

  it('should include glossary aliases', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('우수고객');
  });

  it('should include user query', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('VIP고객정보를 조회해줘');
  });

  it('should request JSON array output', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toMatch(/JSON/i);
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
