/**
 * relationship-inference.ts 유닛 테스트
 */

import { jest } from '@jest/globals';

// chalk ESM 문제 우회: logger 모듈 모킹
jest.unstable_mockModule('../../src/logger/index.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// charset-converter 모킹
jest.unstable_mockModule('../../src/database/charset-converter.js', () => ({
  encodeForOracle: jest.fn((value: string) => value),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
let pluralize: any;
let singularize: any;
let buildSchemaFilter: any;
let loadMetadataQueries: any;
let inferByLLM: any;

describe('relationship-inference', () => {
  beforeAll(async () => {
    const inference = await import(
      '../../src/database/metadata/relationship-inference.js'
    );
    pluralize = inference.pluralize;
    singularize = inference.singularize;
    buildSchemaFilter = inference.buildSchemaFilter;

    const queryLoader = await import(
      '../../src/database/metadata/query-loader.js'
    );
    loadMetadataQueries = queryLoader.loadMetadataQueries;
    inferByLLM = (inference as any).inferByLLM;
  });
  describe('pluralize', () => {
    it('should add "s" suffix', () => {
      const result = pluralize('customer');
      expect(result).toContain('customers');
    });

    it('should add "es" suffix for words ending in sh/ch/s/x/z', () => {
      expect(pluralize('dish')).toContain('dishes');
      expect(pluralize('match')).toContain('matches');
      expect(pluralize('bus')).toContain('buses');
      expect(pluralize('box')).toContain('boxes');
    });

    it('should convert y to ies for consonant+y', () => {
      const result = pluralize('category');
      expect(result).toContain('categories');
    });

    it('should not convert y to ies for vowel+y', () => {
      const result = pluralize('key');
      expect(result).not.toContain('kies');
    });

    it('should return multiple candidates', () => {
      const result = pluralize('order');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result).toContain('orders');
    });

    it('should handle empty string', () => {
      const result = pluralize('');
      expect(result).toContain('s');
    });
  });

  describe('singularize', () => {
    it('should remove "s" suffix', () => {
      const result = singularize('customers');
      expect(result).toContain('customer');
    });

    it('should convert ies to y', () => {
      const result = singularize('categories');
      expect(result).toContain('category');
    });

    it('should remove "es" for sh/ch/ss/x/z words', () => {
      expect(singularize('dishes')).toContain('dish');
      expect(singularize('matches')).toContain('match');
      expect(singularize('boxes')).toContain('box');
    });

    it('should not remove "s" from words ending in "ss"', () => {
      const result = singularize('class');
      // 'class' ends in 'ss', so we should not strip just 's'
      expect(result).not.toContain('clas');
    });

    it('should handle words that are already singular', () => {
      // 'user' doesn't end in 's', so no candidates
      const result = singularize('user');
      expect(result).toHaveLength(0);
    });
  });

  describe('buildSchemaFilter', () => {
    it('should generate schema-specific filter when schema is provided', () => {
      const queryDef = {
        sql: 'SELECT * FROM t WHERE 1=1 {{SCHEMA_FILTER}}',
        mapping: {},
        systemSchemas: ['pg_catalog', 'information_schema'],
        schemaFilterColumn: 'c.table_schema',
      };

      const result = buildSchemaFilter(queryDef, 'public');
      expect(result.sql).toContain('AND c.table_schema = ?');
      expect(result.bindings).toEqual(['public']);
    });

    it('should generate NOT IN filter when schema is not provided', () => {
      const queryDef = {
        sql: 'SELECT * FROM t WHERE 1=1 {{SCHEMA_FILTER}}',
        mapping: {},
        systemSchemas: ['pg_catalog', 'information_schema'],
        schemaFilterColumn: 'c.table_schema',
      };

      const result = buildSchemaFilter(queryDef);
      expect(result.sql).toContain('AND c.table_schema NOT IN (?,?)');
      expect(result.bindings).toEqual(['pg_catalog', 'information_schema']);
    });

    it('should use default filter column when schemaFilterColumn is missing', () => {
      const queryDef = {
        sql: 'SELECT * FROM t WHERE 1=1 {{SCHEMA_FILTER}}',
        mapping: {},
        systemSchemas: [],
      };

      const result = buildSchemaFilter(queryDef, 'myschema');
      expect(result.sql).toContain('AND table_schema = ?');
    });

    it('should handle empty systemSchemas without schema', () => {
      const queryDef = {
        sql: 'SELECT * FROM t WHERE 1=1 {{SCHEMA_FILTER}}',
        mapping: {},
        systemSchemas: [],
        schemaFilterColumn: 's.TABLE_SCHEMA',
      };

      const result = buildSchemaFilter(queryDef);
      expect(result.sql).toContain('AND s.TABLE_SCHEMA NOT IN ()');
      expect(result.bindings).toEqual([]);
    });
  });

  describe('YAML query loading', () => {
    it('should load inferenceColumns query for postgresql', () => {
      const config = loadMetadataQueries('postgresql');
      expect(config.queries.inferenceColumns).toBeDefined();
      expect(config.queries.inferenceColumns!.sql).toContain(
        'information_schema.columns'
      );
      expect(config.queries.inferenceColumns!.mapping).toHaveProperty(
        'tableSchema'
      );
    });

    it('should load inferenceColumns query for mysql', () => {
      const config = loadMetadataQueries('mysql');
      expect(config.queries.inferenceColumns).toBeDefined();
      expect(config.queries.inferenceColumns!.sql).toContain(
        'information_schema.COLUMNS'
      );
    });

    it('should load inferenceColumns query for oracle', () => {
      const config = loadMetadataQueries('oracle');
      expect(config.queries.inferenceColumns).toBeDefined();
      expect(config.queries.inferenceColumns!.sql).toContain(
        'all_tab_columns'
      );
    });

    it('should load inferenceConstraints for all DBMS', () => {
      for (const dbType of ['postgresql', 'mysql', 'oracle'] as const) {
        const config = loadMetadataQueries(dbType);
        expect(config.queries.inferenceConstraints).toBeDefined();
        expect(config.queries.inferenceConstraints!.mapping).toHaveProperty(
          'constraintType'
        );
      }
    });

    it('should load inferenceUpsert for all DBMS', () => {
      for (const dbType of ['postgresql', 'mysql', 'oracle'] as const) {
        const config = loadMetadataQueries(dbType);
        expect(config.queries.inferenceUpsert).toBeDefined();
        expect(config.queries.inferenceUpsert!.sql).toBeTruthy();
      }
    });

    it('should have {{DESCRIPTION_BIND}} placeholder only in oracle upsert', () => {
      const oracle = loadMetadataQueries('oracle');
      expect(oracle.queries.inferenceUpsert!.sql).toContain(
        '{{DESCRIPTION_BIND}}'
      );

      const pg = loadMetadataQueries('postgresql');
      expect(pg.queries.inferenceUpsert!.sql).not.toContain(
        '{{DESCRIPTION_BIND}}'
      );

      const mysql = loadMetadataQueries('mysql');
      expect(mysql.queries.inferenceUpsert!.sql).not.toContain(
        '{{DESCRIPTION_BIND}}'
      );
    });

    it('should have systemSchemas defined in inference queries', () => {
      for (const dbType of ['postgresql', 'mysql', 'oracle'] as const) {
        const config = loadMetadataQueries(dbType);
        const colQuery = config.queries.inferenceColumns as {
          systemSchemas?: string[];
        };
        expect(colQuery.systemSchemas).toBeDefined();
        expect(colQuery.systemSchemas!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('inferByNamingConvention (logic validation)', () => {
    it('should match standard_id_suffix pattern', () => {
      const pattern = /^(.+)_id$/i;
      const match = 'customer_id'.match(pattern);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('customer');
    });

    it('should match standard_no_suffix pattern', () => {
      const pattern = /^(.+)_no$/i;
      const match = 'order_no'.match(pattern);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('order');
    });

    it('should match standard_code_suffix pattern', () => {
      const pattern = /^(.+)_(?:code|cd)$/i;
      const match = 'product_code'.match(pattern);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('product');

      const matchCd = 'status_cd'.match(pattern);
      expect(matchCd).not.toBeNull();
      expect(matchCd![1]).toBe('status');
    });

    it('should not match non-FK column names', () => {
      const pattern = /^(.+)_id$/i;
      expect('username'.match(pattern)).toBeNull();
      expect('description'.match(pattern)).toBeNull();
    });

    it('should handle pattern replacement ($1)', () => {
      const columnName = 'customer_id';
      const pattern = /^(.+)_id$/i;
      const match = columnName.match(pattern);
      const targetTablePattern = '$1';
      const targetColumnPattern = 'id';

      let candidateTable = targetTablePattern;
      let candidateColumn = targetColumnPattern;

      if (match && match[1]) {
        candidateTable = candidateTable.replace('$1', match[1]);
        candidateColumn = candidateColumn.replace('$1', match[1]);
      }

      expect(candidateTable).toBe('customer');
      expect(candidateColumn).toBe('id');
    });
  });

  describe('column match logic validation', () => {
    it('should identify PK vs FK side correctly', () => {
      const pkColumns = new Set(['public.users.id', 'public.products.id']);

      expect(pkColumns.has('public.users.id')).toBe(true);
      expect(pkColumns.has('public.orders.user_id')).toBe(false);
    });

    it('should require matching data types', () => {
      const fk = { dataType: 'integer' };
      const pk = { dataType: 'integer' };
      expect(fk.dataType.toLowerCase() === pk.dataType.toLowerCase()).toBe(
        true
      );

      const fk2 = { dataType: 'varchar' };
      const pk2 = { dataType: 'integer' };
      expect(fk2.dataType.toLowerCase() === pk2.dataType.toLowerCase()).toBe(
        false
      );
    });
  });

  describe('edge cases', () => {
    it('pluralize should handle single char', () => {
      const result = pluralize('x');
      expect(result).toContain('xs');
    });

    it('singularize should handle "ies" ending', () => {
      const result = singularize('entries');
      expect(result).toContain('entry');
    });

    it('singularize should handle "sses" ending', () => {
      const result = singularize('classes');
      expect(result).toContain('class');
    });

    it('pluralize should produce unique candidates for "company"', () => {
      const result = pluralize('company');
      expect(result).toContain('companys');
      expect(result).toContain('companies');
    });
  });
  describe('inferByLLM', () => {
    const mockAIProvider = {
      generateInferFK: jest.fn(),
      generateSQL: jest.fn(),
      generateComment: jest.fn(),
      selectTables: jest.fn(),
    };

    const mockSchemaTables = [
      {
        name: 'RESERVATIONS',
        schemaName: 'NL2SQL',
        comment: '예약 테이블',
        columns: [
          { name: 'RESERVATION_ID', type: 'NUMBER', isPrimaryKey: true, nullable: false },
          { name: 'STORE_ID', type: 'NUMBER', isPrimaryKey: false, nullable: false },
          { name: 'MEMBER_ID', type: 'NUMBER', isPrimaryKey: false, nullable: false },
        ],
        indexes: [],
      },
      {
        name: 'STORES',
        schemaName: 'NL2SQL',
        comment: '매장 테이블',
        columns: [
          { name: 'STORE_ID', type: 'NUMBER', isPrimaryKey: true, nullable: false },
          { name: 'STORE_NAME', type: 'VARCHAR2', isPrimaryKey: false, nullable: false },
        ],
        indexes: [],
      },
    ];

    const existingSet = new Set<string>();

    it('should call aiProvider.generateInferFK and return mapped InferredRelationship[]', async () => {
      mockAIProvider.generateInferFK.mockResolvedValueOnce(JSON.stringify([
        {
          source_schema: 'NL2SQL',
          source_table: 'RESERVATIONS',
          source_column: 'STORE_ID',
          target_schema: 'NL2SQL',
          target_table: 'STORES',
          target_column: 'STORE_ID',
          relationship_type: 'MANY_TO_ONE',
          confidence: 'HIGH',
          join_hint: 'INNER',
          description: '예약 → 매장 관계',
        },
      ]));

      const result = await inferByLLM(mockAIProvider, mockSchemaTables, undefined, existingSet);

      expect(result).toHaveLength(1);
      expect(result[0].sourceTable).toBe('RESERVATIONS');
      expect(result[0].targetTable).toBe('STORES');
      expect(result[0].confidenceLevel).toBe('HIGH');
      expect(result[0].relationshipType).toBe('MANY_TO_ONE');
      expect(result[0].joinHint).toBe('INNER');
      expect(result[0].description).toBe('예약 → 매장 관계');
      expect(result[0].inferenceType).toBe('column_match');
    });

    it('should skip relationships already in existingSet', async () => {
      const existingWithDup = new Set([
        'nl2sql.reservations.store_id→nl2sql.stores.store_id',
      ]);

      mockAIProvider.generateInferFK.mockResolvedValueOnce(JSON.stringify([
        {
          source_schema: 'NL2SQL',
          source_table: 'RESERVATIONS',
          source_column: 'STORE_ID',
          target_schema: 'NL2SQL',
          target_table: 'STORES',
          target_column: 'STORE_ID',
          relationship_type: 'MANY_TO_ONE',
          confidence: 'HIGH',
          join_hint: 'INNER',
          description: '예약 → 매장 관계',
        },
      ]));

      const result = await inferByLLM(mockAIProvider, mockSchemaTables, undefined, existingWithDup);
      expect(result).toHaveLength(0);
    });

    it('should return [] and log warn when LLM returns invalid JSON', async () => {
      mockAIProvider.generateInferFK.mockResolvedValueOnce('not json');
      const result = await inferByLLM(mockAIProvider, mockSchemaTables, undefined, existingSet);
      expect(result).toHaveLength(0);
    });

    it('should return [] gracefully when aiProvider is undefined', async () => {
      const result = await inferByLLM(undefined, mockSchemaTables, undefined, existingSet);
      expect(result).toHaveLength(0);
    });
  });

});
