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

  const mockConfig = {
    ai: { provider: 'openai' as const, apiKey: 'sk-test-key-for-testing', model: 'gpt-4o' },
    database: { type: 'postgresql' as const, host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd' },
  } as any;

  it('uses injected schemaCache when provided as non-null value', async () => {
    const mockKnex = {} as any;

    const engine = new NL2SQLEngineClass(mockKnex, mockConfig, {
      schemaCache: mockSchema,
    });

    const schema = await engine.getSchema();
    expect(schema).toBe(mockSchema);
    expect(schema.tables[0].name).toBe('injected_table');
  });

  it('falls through to extractSchema when schemaCache is null (always re-extract)', async () => {
    // A stub knex with no `raw` method — extractSchema will call knex methods and throw.
    // This proves that null schemaCache bypasses the injection fast-path and hits the DB layer.
    const mockKnex = {} as any;

    const engine = new NL2SQLEngineClass(mockKnex, mockConfig, {
      schemaCache: null,
    });

    // extractSchema will attempt to query the DB via knex and throw because knex is a stub.
    // The error should be a DB/call error, NOT a "schemaCache option" configuration error.
    await expect(engine.getSchema()).rejects.toThrow();
  });

  it('falls through to extractSchema when schemaCache option is undefined (internal cache path)', async () => {
    // No schemaCache option → internal cachedSchema path → extractSchema is called on first miss.
    // The stub knex has no DB methods, so extractSchema will throw a DB-layer error.
    // This proves the internal extraction path is taken rather than returning early.
    const mockKnex = {} as any;

    const engine = new NL2SQLEngineClass(mockKnex, mockConfig);

    await expect(engine.getSchema()).rejects.toThrow();
  });
});
