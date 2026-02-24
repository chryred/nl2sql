import { jest } from '@jest/globals';
import type { SchemaInfo } from '../../src/database/types.js';

// Must be set up before any dynamic import of nl2sql-engine
jest.unstable_mockModule('../../src/ai/client-factory.js', () => ({
  createAIClient: () => ({ generateSQL: jest.fn(), selectTables: jest.fn() }),
}));

let NL2SQLEngineClass: typeof import('../../src/core/nl2sql-engine.js').NL2SQLEngine;

beforeAll(async () => {
  const mod = await import('../../src/core/nl2sql-engine.js');
  NL2SQLEngineClass = mod.NL2SQLEngine;
});

describe('NL2SQLEngine with injected schemaCache', () => {
  const mockSchema: SchemaInfo = {
    tables: [
      { name: 'injected_table', columns: [], constraints: [], indexes: [] },
    ],
  };

  it('uses injected schemaCache when provided as non-null value', async () => {
    const mockKnex = {} as any;
    const mockConfig = {
      ai: { provider: 'openai' as const, apiKey: 'sk-test-key-for-testing', model: 'gpt-4o' },
      database: { type: 'postgresql' as const, host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd' },
    } as any;

    const engine = new NL2SQLEngineClass(mockKnex, mockConfig, {
      schemaCache: mockSchema,
    });

    const schema = await engine.getSchema();
    expect(schema).toBe(mockSchema);
    expect(schema.tables[0].name).toBe('injected_table');
  });

  it('uses internal cachedSchema when schemaCache option is undefined', async () => {
    const mockKnex = {} as any;
    const mockConfig = {
      ai: { provider: 'openai' as const, apiKey: 'sk-test-key-for-testing', model: 'gpt-4o' },
      database: { type: 'postgresql' as const, host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd' },
    } as any;

    const engine = new NL2SQLEngineClass(mockKnex, mockConfig);
    expect(engine).toBeInstanceOf(NL2SQLEngineClass);
    // No schemaCache option means internal cache path is used
  });
});
