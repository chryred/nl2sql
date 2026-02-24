import { jest } from '@jest/globals';
import type { SchemaInfo } from '../../src/database/types.js';

// AI 클라이언트 mock (동적 import 이전에 설정해야 함)
const mockSelectTables = jest.fn<() => Promise<string>>();
jest.unstable_mockModule('../../src/ai/client-factory.js', () => ({
  createAIClient: () => ({
    generateSQL: jest.fn(),
    selectTables: mockSelectTables,
  }),
}));

// extractSchema mock
jest.unstable_mockModule('../../src/database/schema-extractor.js', () => ({
  extractSchema: jest.fn(),
  formatSchemaSummary: () => 'table summary',
  formatSchemaForPrompt: jest.fn(),
  formatIndexesForPrompt: jest.fn(),
}));

// metadata mock (사용 안 함)
jest.unstable_mockModule('../../src/database/metadata/index.js', () => ({
  getMetadataCache: () => null,
  initializeMetadataCache: jest.fn(),
}));

let NL2SQLEngineClass: typeof import('../../src/core/nl2sql-engine.js').NL2SQLEngine;
let extractSchemaMock: jest.MockedFunction<any>;

beforeAll(async () => {
  const mod = await import('../../src/core/nl2sql-engine.js');
  NL2SQLEngineClass = mod.NL2SQLEngine;
  const schemaMod = await import('../../src/database/schema-extractor.js');
  extractSchemaMock = schemaMod.extractSchema as jest.MockedFunction<any>;
});

const fullSchema: SchemaInfo = {
  tables: [
    { name: 'customers', columns: [], constraints: [], indexes: [] },
    { name: 'orders', columns: [], constraints: [], indexes: [] },
    { name: 'products', columns: [], constraints: [], indexes: [] },
  ],
};

const mockConfig = {
  ai: { provider: 'openai' as const, apiKey: 'sk-test-key', model: 'gpt-4o' },
  database: { type: 'postgresql' as const, host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd' },
} as any;

describe('NL2SQLEngine.getSchemaByQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    extractSchemaMock.mockResolvedValue(fullSchema);
  });

  it('LLM이 테이블을 선별하면 해당 테이블만 포함된 스키마를 반환한다', async () => {
    mockSelectTables.mockResolvedValue('["customers", "orders"]');

    const engine = new NL2SQLEngineClass({} as any, mockConfig);
    const result = await engine.getSchemaByQuery('고객 주문 조회');

    expect(result.tables).toHaveLength(2);
    expect(result.tables.map((t) => t.name)).toEqual(['customers', 'orders']);
  });

  it('LLM이 빈 배열을 반환하면 전체 스키마로 fallback한다', async () => {
    mockSelectTables.mockResolvedValue('[]');

    const engine = new NL2SQLEngineClass({} as any, mockConfig);
    const result = await engine.getSchemaByQuery('알 수 없는 쿼리');

    expect(result.tables).toHaveLength(3);
  });

  it('LLM 응답 파싱 실패 시 전체 스키마로 fallback한다', async () => {
    mockSelectTables.mockResolvedValue('invalid response');

    const engine = new NL2SQLEngineClass({} as any, mockConfig);
    const result = await engine.getSchemaByQuery('파싱 실패 케이스');

    expect(result.tables).toHaveLength(3);
  });
});
