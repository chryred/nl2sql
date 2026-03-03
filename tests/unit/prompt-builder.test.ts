/**
 * prompt-builder.ts 유닛 테스트
 *
 * buildTableSelectionPrompt, parseSelectedTables 함수 테스트
 */

import { buildTableSelectionPrompt, parseSelectedTables, buildPrompt, buildOracleKoreanWrapPrompt } from '../../src/ai/prompt-builder.js';
import type { SchemaInfo } from '../../src/database/schema-extractor.js';
import type {
  GlossaryTerm,
  GlossaryAlias,
  TableRelationship,
  QueryPattern,
  PatternKeyword,
  CodeTable,
  ColumnCodeMapping,
  MetadataCache,
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
      schemaName: 'public',
      comment: '고객',
      columns: [{ name: 'cust_name', type: 'VARCHAR2(100)', nullable: false, comment: '고객명', isPrimaryKey: false, isForeignKey: false, defaultValue: null }],
      constraints: [],
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
          { name: 'customer_name', type: 'VARCHAR2(100)', nullable: true, comment: '고객명', isPrimaryKey: false, isForeignKey: false, defaultValue: null },
          { name: 'id', type: 'NUMBER', nullable: false, comment: 'ID', isPrimaryKey: true, isForeignKey: false, defaultValue: null },
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

describe('buildPrompt with code mappings', () => {
  const schema: SchemaInfo = {
    tables: [{
      name: 'orders',
      schemaName: 'dbo',
      columns: [
        { name: 'STATUS', type: 'VARCHAR2(2)', nullable: true, comment: '상태코드', isPrimaryKey: false, isForeignKey: false, defaultValue: null },
        { name: 'ORDER_ID', type: 'NUMBER', nullable: false, comment: '주문ID', isPrimaryKey: true, isForeignKey: false, defaultValue: null },
      ],
      constraints: [],
      indexes: [],
    }],
    recentQueries: [],
  };

  const baseMetadata: MetadataCache = {
    relationships: [],
    namingConventions: [],
    codeTables: [{
      codeTableName: 'STATUS_CODE',
      tableSchema: 'dbo',
      tableName: 'COM_CODE',
      groupCodeColumn: 'GROUP_CD',
      codeColumn: 'CODE',
      codeNameColumn: 'CODE_NM',
    }],
    columnCodeMappings: [{
      targetSchema: 'dbo',
      targetTable: 'orders',
      targetColumn: 'STATUS',
      codeTableName: 'STATUS_CODE',
      groupCode: 'L001',
      includeInPrompt: true,
    }],
    codeAliases: [
      { codeTableName: 'STATUS_CODE', groupCode: 'L001', codeValue: '01', alias: '신청' },
      { codeTableName: 'STATUS_CODE', groupCode: 'L001', codeValue: '02', alias: '취소' },
    ],
    glossaryTerms: [],
    glossaryAliases: [],
    glossaryContexts: [],
    queryPatterns: [],
    patternParameters: [],
    patternKeywords: [],
    loadedAt: new Date(),
    databaseType: 'oracle',
  };

  it('should include Column Code Lookups section when mappings exist', () => {
    const result = buildPrompt({ tables: schema, naturalLanguageQuery: '주문 현황 조회', dbType: 'oracle', metadata: baseMetadata });
    expect(result).toContain('Column Code Lookups');
  });

  it('should include JOIN instruction for mapped column', () => {
    const result = buildPrompt({ tables: schema, naturalLanguageQuery: '주문 현황 조회', dbType: 'oracle', metadata: baseMetadata });
    expect(result).toContain('JOIN dbo.COM_CODE');
    expect(result).toContain("GROUP_CD = 'L001'");
  });

  it('should include SELECT code name instruction', () => {
    const result = buildPrompt({ tables: schema, naturalLanguageQuery: '주문 현황 조회', dbType: 'oracle', metadata: baseMetadata });
    expect(result).toContain('CODE_NM');
    expect(result).toContain('status_nm');
  });

  it('should include WHERE hints from codeAliases', () => {
    const result = buildPrompt({ tables: schema, naturalLanguageQuery: '주문 현황 조회', dbType: 'oracle', metadata: baseMetadata });
    expect(result).toContain('01=신청');
    expect(result).toContain('02=취소');
  });

  it('should skip code mapping with includeInPrompt=false', () => {
    const metadataExcluded: MetadataCache = {
      ...baseMetadata,
      columnCodeMappings: [{ ...baseMetadata.columnCodeMappings[0], includeInPrompt: false }],
    };
    const result = buildPrompt({ tables: schema, naturalLanguageQuery: '주문 현황 조회', dbType: 'oracle', metadata: metadataExcluded });
    expect(result).not.toContain('Column Code Lookups');
  });

  it('should skip code section when no columnCodeMappings', () => {
    const metadataEmpty: MetadataCache = {
      ...baseMetadata,
      columnCodeMappings: [],
    };
    const result = buildPrompt({ tables: schema, naturalLanguageQuery: '주문 현황 조회', dbType: 'oracle', metadata: metadataEmpty });
    expect(result).not.toContain('Column Code Lookups');
  });
});

describe('buildTableSelectionPrompt with code table dependencies', () => {
  const tableSummary = 'dbo.orders -- 주문\ndbo.COM_CODE -- 공통코드';

  const codeTables: CodeTable[] = [{
    codeTableName: 'STATUS_CODE',
    tableSchema: 'dbo',
    tableName: 'COM_CODE',
    groupCodeColumn: 'GROUP_CD',
    codeColumn: 'CODE',
    codeNameColumn: 'CODE_NM',
  }];

  const columnCodeMappings: ColumnCodeMapping[] = [{
    targetSchema: 'dbo',
    targetTable: 'orders',
    targetColumn: 'STATUS',
    codeTableName: 'STATUS_CODE',
    groupCode: 'L001',
    includeInPrompt: true,
  }];

  it('should include code table dependency hint when mappings exist', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], [], [], [], '주문 목록', codeTables, columnCodeMappings
    );
    expect(result).toContain('Code Table Dependencies');
    expect(result).toContain('orders.STATUS');
    expect(result).toContain('COM_CODE');
  });

  it('should skip code table dependencies when no mappings provided', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], [], [], [], '주문 목록'
    );
    expect(result).not.toContain('Code Table Dependencies');
  });

  it('should skip mapping with includeInPrompt=false', () => {
    const excludedMappings: ColumnCodeMapping[] = [{
      ...columnCodeMappings[0],
      includeInPrompt: false,
    }];
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], [], [], [], '주문 목록', codeTables, excludedMappings
    );
    expect(result).not.toContain('Code Table Dependencies');
  });
});

describe('buildOracleKoreanWrapPrompt', () => {
  const schema: SchemaInfo = {
    tables: [
      {
        name: 'customers',
        columns: [
          { name: 'customer_name', type: 'VARCHAR2(100)', nullable: true, comment: '고객명', isPrimaryKey: false, isForeignKey: false, defaultValue: null },
          { name: 'grade', type: 'VARCHAR2(10)', nullable: true, comment: '등급', isPrimaryKey: false, isForeignKey: false, defaultValue: null },
          { name: 'id', type: 'NUMBER', nullable: false, comment: 'ID', isPrimaryKey: true, isForeignKey: false, defaultValue: null },
        ],
        constraints: [],
        indexes: [],
      },
    ],
  };

  const sql = "SELECT id, customer_name, grade FROM customers WHERE grade = 'VIP'";

  it('should include the original SQL in prompt', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain(sql);
  });

  it('should instruct LLM to apply UTL_RAW.CAST_TO_RAW', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain('UTL_RAW.CAST_TO_RAW');
  });

  it('should include schema column info in prompt', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain('customer_name');
    expect(prompt).toContain('VARCHAR2');
  });

  it('should instruct to return SQL only', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain('SQL only');
  });

  it('should include charset info', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain('ms949');
  });
});
