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
});
