import { jest } from '@jest/globals';
import type { SchemaInfo } from '../../src/database/types.js';

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

describe('NL2SQLEngine.process - oracle UTL_RAW wrapping', () => {
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

  const cleanSql = 'SELECT id, customer_name FROM customers';
  const wrappedSql =
    'SELECT id, UTL_RAW.CAST_TO_RAW(customer_name) AS customer_name FROM customers';

  const mockKnex = { raw: jest.fn().mockResolvedValue([]) } as any;
  const oracleConfig = {
    database: { type: 'oracle' as const, oracleDataCharset: 'ms949' },
    ai: { provider: 'openai' as const, model: 'gpt-4o', openaiApiKey: 'sk-test-key' },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKnex.raw.mockResolvedValue([]);
  });

  it('should wrap Korean columns and execute with wrapped SQL when execute=true and oracleDataCharset set', async () => {
    const mockAiClient = {
      generateSQL: jest.fn()
        .mockResolvedValueOnce(cleanSql)    // 1st call: NL→SQL
        .mockResolvedValueOnce(wrappedSql), // 2nd call: wrapOracleKoreanColumns
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, oracleConfig, { schemaCache: mockSchema, metadataCache: null });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.process('고객 이름 조회', true);

    // output.sql is always the clean readable SQL
    expect(result.sql).toBe(cleanSql);
    // executeSQL was called with the wrapped SQL
    expect(mockKnex.raw).toHaveBeenCalledWith(wrappedSql);
    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(2);
  });

  it('should NOT call wrapOracleKoreanColumns when execute=false', async () => {
    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(cleanSql),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, oracleConfig, { schemaCache: mockSchema, metadataCache: null });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.process('고객 이름 조회', false);

    expect(result.sql).toBe(cleanSql);
    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(1); // only NL→SQL, no wrap
    expect(mockKnex.raw).not.toHaveBeenCalled();
  });

  it('should NOT call wrapOracleKoreanColumns for non-oracle DB', async () => {
    const postgresConfig = {
      database: { type: 'postgresql' as const },
      ai: { provider: 'openai' as const, model: 'gpt-4o', openaiApiKey: 'sk-test-key' },
    } as any;

    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(cleanSql),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, postgresConfig, { schemaCache: mockSchema, metadataCache: null });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.process('고객 이름 조회', true);

    expect(result.sql).toBe(cleanSql);
    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(1); // only NL→SQL
    expect(mockKnex.raw).toHaveBeenCalledWith(cleanSql); // no wrapping
  });
});
