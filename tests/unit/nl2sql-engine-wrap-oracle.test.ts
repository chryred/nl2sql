import { jest } from '@jest/globals';
import type { SchemaInfo } from '../../src/database/types.js';

// Mock client-factory before NL2SQLEngine is dynamically imported
jest.unstable_mockModule('../../src/ai/client-factory.js', () => ({
  createAIClient: () => ({
    generateSQL: jest.fn(),
    selectTables: jest.fn(),
    generateInferFK: jest.fn(),
    generateComment: jest.fn(),
  }),
}));

let NL2SQLEngine: typeof import('../../src/core/nl2sql-engine.js').NL2SQLEngine;

beforeAll(async () => {
  const mod = await import('../../src/core/nl2sql-engine.js');
  NL2SQLEngine = mod.NL2SQLEngine;
});

describe('NL2SQLEngine.wrapOracleKoreanColumns', () => {
  const mockSchema: SchemaInfo = {
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

  const originalSql = 'SELECT id, customer_name FROM customers';
  const wrappedSql =
    'SELECT id, UTL_RAW.CAST_TO_RAW(customer_name) AS customer_name FROM customers';

  const mockKnex = {} as any;
  const mockConfig = {
    database: { type: 'oracle' as const, oracleDataCharset: 'ms949' },
    ai: { provider: 'openai' as const, model: 'gpt-4o', openaiApiKey: 'sk-test-key' },
  } as any;

  it('should call aiClient.generateSQL with wrap prompt and return parsed SQL', async () => {
    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(wrappedSql),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, mockConfig, {
      schemaCache: mockSchema,
    });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.wrapOracleKoreanColumns(originalSql);

    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(1);
    const promptArg = mockAiClient.generateSQL.mock.calls[0][0] as string;
    expect(promptArg).toContain('UTL_RAW.CAST_TO_RAW');
    expect(promptArg).toContain(originalSql);
    expect(result).toBe(wrappedSql);
  });

  it('should return original sql if aiClient returns empty response', async () => {
    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(''),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, mockConfig, {
      schemaCache: mockSchema,
    });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.wrapOracleKoreanColumns(originalSql);
    expect(result).toBe(originalSql);
  });

  it('should return original sql immediately when oracleDataCharset is not set', async () => {
    const configWithoutCharset = {
      database: { type: 'oracle' as const },
      ai: { provider: 'openai' as const, model: 'gpt-4o', openaiApiKey: 'sk-test-key' },
    } as any;

    const mockAiClient = {
      generateSQL: jest.fn(),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, configWithoutCharset, {
      schemaCache: mockSchema,
    });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.wrapOracleKoreanColumns(originalSql);
    expect(result).toBe(originalSql);
    expect(mockAiClient.generateSQL).not.toHaveBeenCalled();
  });

  it('should pass only SQL-referenced tables schema to wrap prompt (not full schema)', async () => {
    // 전체 스키마에는 customers와 unrelated_table 두 테이블이 있음
    const fullSchema: SchemaInfo = {
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
        {
          name: 'unrelated_table',
          columns: [
            { name: 'some_col', type: 'VARCHAR2(200)', nullable: true, comment: '무관한 컬럼' },
          ],
          constraints: [],
          indexes: [],
        },
      ],
    };

    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(wrappedSql),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    // SQL: customers만 참조
    const engine = new NL2SQLEngine(mockKnex, mockConfig, {
      schemaCache: fullSchema,
    });
    (engine as any).aiClient = mockAiClient;

    await engine.wrapOracleKoreanColumns(originalSql); // FROM customers

    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(1);
    const promptArg = mockAiClient.generateSQL.mock.calls[0][0] as string;
    // 프롬프트에 customers 테이블 정보 포함
    expect(promptArg).toContain('customers');
    // 프롬프트에 unrelated_table 정보 미포함
    expect(promptArg).not.toContain('unrelated_table');
  });
});
