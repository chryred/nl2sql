/**
 * schema-extractor.ts 유닛 테스트
 */

import { formatSchemaSummary } from '../../src/database/schema-extractor.js';
import type { SchemaInfo } from '../../src/database/types.js';

describe('formatSchemaSummary', () => {
  it('should format table names with comments', () => {
    const schema: SchemaInfo = {
      tables: [
        {
          name: 'customers',
          schemaName: 'public',
          comment: '고객 마스터',
          columns: [],
          constraints: [],
          indexes: [],
        },
        {
          name: 'orders',
          schemaName: 'public',
          comment: '주문',
          columns: [],
          constraints: [],
          indexes: [],
        },
      ],
    };
    const result = formatSchemaSummary(schema);
    expect(result).toContain('customers -- 고객 마스터');
    expect(result).toContain('orders -- 주문');
    expect(result).not.toContain('columns');
  });

  it('should handle tables without comments', () => {
    const schema: SchemaInfo = {
      tables: [
        {
          name: 'logs',
          columns: [],
          constraints: [],
          indexes: [],
        },
      ],
    };
    const result = formatSchemaSummary(schema);
    expect(result).toContain('logs');
    expect(result).not.toContain('--');
  });

  it('should include schema prefix when present', () => {
    const schema: SchemaInfo = {
      tables: [
        {
          name: 'users',
          schemaName: 'hr',
          comment: '사용자',
          columns: [],
          constraints: [],
          indexes: [],
        },
      ],
    };
    const result = formatSchemaSummary(schema);
    expect(result).toContain('hr.users -- 사용자');
  });
});
