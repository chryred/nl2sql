import { filterSchemaByTables, filterMetadataByTables } from '../../src/core/nl2sql-engine.js';
import type { SchemaInfo } from '../../src/database/types.js';
import type { MetadataCache } from '../../src/database/metadata/types.js';

describe('filterSchemaByTables', () => {
  const schema: SchemaInfo = {
    tables: [
      { name: 'customers', columns: [], constraints: [], indexes: [] },
      { name: 'orders', columns: [], constraints: [], indexes: [] },
      { name: 'products', columns: [], constraints: [], indexes: [] },
    ],
  };

  it('should filter to only selected tables', () => {
    const result = filterSchemaByTables(schema, ['customers', 'orders']);
    expect(result.tables).toHaveLength(2);
    expect(result.tables.map((t) => t.name)).toEqual(['customers', 'orders']);
  });

  it('should return empty tables for no matches', () => {
    const result = filterSchemaByTables(schema, ['nonexistent']);
    expect(result.tables).toHaveLength(0);
  });

  it('should be case-insensitive', () => {
    const result = filterSchemaByTables(schema, ['CUSTOMERS']);
    expect(result.tables).toHaveLength(1);
  });
});

describe('filterMetadataByTables', () => {
  const metadata = {
    relationships: [
      {
        sourceTable: 'orders',
        sourceColumn: 'customer_id',
        targetTable: 'customers',
        targetColumn: 'id',
        relationshipType: 'MANY_TO_ONE',
        confidence: 'HIGH',
      },
      {
        sourceTable: 'products',
        sourceColumn: 'category_id',
        targetTable: 'categories',
        targetColumn: 'id',
        relationshipType: 'MANY_TO_ONE',
        confidence: 'HIGH',
      },
    ],
    glossaryTerms: [
      {
        termCode: 'VIP',
        term: 'VIP고객',
        category: 'business_term',
        sqlCondition: "grade = 'VIP'",
        applyToTables: ['customers'],
        priority: 1,
      },
      {
        termCode: 'STOCK',
        term: '재고',
        category: 'business_term',
        sqlCondition: "stock > 0",
        applyToTables: ['products'],
        priority: 1,
      },
    ],
    queryPatterns: [
      {
        patternCode: 'P1',
        patternName: '고객 조회',
        category: 'lookup',
        sqlTemplate: 'SELECT * FROM customers',
        applicableTables: ['customers'],
        matchScoreThreshold: 0.5,
        priority: 1,
      },
    ],
    namingConventions: [],
    codeTables: [],
    columnCodeMappings: [],
    codeAliases: [],
    glossaryAliases: [],
    glossaryContexts: [],
    patternParameters: [],
    patternKeywords: [],
    loadedAt: new Date(),
    databaseType: 'postgresql',
  } as unknown as MetadataCache;

  it('should filter relationships to selected tables', () => {
    const result = filterMetadataByTables(metadata, ['customers', 'orders']);
    expect(result!.relationships).toHaveLength(1);
    expect(result!.relationships[0].sourceTable).toBe('orders');
  });

  it('should filter glossary terms to selected tables', () => {
    const result = filterMetadataByTables(metadata, ['customers']);
    expect(result!.glossaryTerms).toHaveLength(1);
    expect(result!.glossaryTerms[0].termCode).toBe('VIP');
  });

  it('should filter query patterns to selected tables', () => {
    const result = filterMetadataByTables(metadata, ['customers']);
    expect(result!.queryPatterns).toHaveLength(1);
  });

  it('should return null for null metadata', () => {
    const result = filterMetadataByTables(null, ['customers']);
    expect(result).toBeNull();
  });

  it('should keep glossary terms without applyToTables (global terms)', () => {
    const metadataWithGlobal = {
      ...metadata,
      glossaryTerms: [
        {
          termCode: 'TODAY',
          term: '오늘',
          category: 'date_term',
          sqlCondition: "CURRENT_DATE",
          priority: 1,
        },
      ],
    } as unknown as MetadataCache;
    const result = filterMetadataByTables(metadataWithGlobal, ['customers']);
    expect(result!.glossaryTerms).toHaveLength(1);
  });
});
