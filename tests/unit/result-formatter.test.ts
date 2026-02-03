/**
 * result-formatter.ts 유닛 테스트
 */

import {
  formatResults,
  isValidFormat,
  SUPPORTED_FORMATS,
} from '../../src/cli/formatters/result-formatter.js';

describe('formatResults', () => {
  const sampleData = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
    { id: 3, name: 'Charlie', email: 'charlie@example.com' },
  ];

  describe('JSON format', () => {
    it('should format as pretty JSON', () => {
      const result = formatResults(sampleData, 'json');
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(sampleData);
    });

    it('should handle empty array', () => {
      const result = formatResults([], 'json');
      expect(result).toBe('[]');
    });

    it('should handle null values', () => {
      const data = [{ id: 1, name: null }];
      const result = formatResults(data, 'json');
      const parsed = JSON.parse(result);
      expect(parsed[0].name).toBeNull();
    });
  });

  describe('CSV format', () => {
    it('should format as CSV with headers', () => {
      const result = formatResults(sampleData, 'csv');
      const lines = result.split('\n');
      expect(lines[0]).toBe('id,name,email');
      expect(lines[1]).toBe('1,Alice,alice@example.com');
    });

    it('should handle empty array', () => {
      const result = formatResults([], 'csv');
      expect(result).toBe('');
    });

    it('should escape commas in values', () => {
      const data = [{ name: 'Doe, John' }];
      const result = formatResults(data, 'csv');
      expect(result).toContain('"Doe, John"');
    });

    it('should escape double quotes in values', () => {
      const data = [{ name: 'He said "Hello"' }];
      const result = formatResults(data, 'csv');
      expect(result).toContain('"He said ""Hello"""');
    });

    it('should escape newlines in values', () => {
      const data = [{ note: 'Line1\nLine2' }];
      const result = formatResults(data, 'csv');
      expect(result).toContain('"Line1\nLine2"');
    });

    it('should handle null values', () => {
      const data = [{ id: 1, name: null }];
      const result = formatResults(data, 'csv');
      expect(result).toBe('id,name\n1,');
    });

    it('should handle undefined values', () => {
      const data = [{ id: 1, name: undefined }];
      const result = formatResults(data, 'csv');
      expect(result).toBe('id,name\n1,');
    });
  });

  describe('Table format', () => {
    it('should format as text table', () => {
      const result = formatResults(sampleData, 'table');
      expect(result).toContain('id');
      expect(result).toContain('name');
      expect(result).toContain('Alice');
      expect(result).toContain('---');
    });

    it('should handle empty array', () => {
      const result = formatResults([], 'table');
      expect(result).toBe('(empty)');
    });

    it('should truncate long values', () => {
      const longValue = 'A'.repeat(100);
      const data = [{ value: longValue }];
      const result = formatResults(data, 'table');
      expect(result).toContain('...');
      // The result includes headers, separators, etc. so we check the value is truncated
      expect(result).not.toContain(longValue);
    });

    it('should handle null values', () => {
      const data = [{ id: 1, name: null }];
      const result = formatResults(data, 'table');
      expect(result).toContain('id');
      expect(result).toContain('name');
    });
  });

  describe('default format', () => {
    it('should default to table format', () => {
      const tableResult = formatResults(sampleData, 'table');
      const defaultResult = formatResults(sampleData);
      expect(defaultResult).toBe(tableResult);
    });
  });
});

describe('isValidFormat', () => {
  it('should return true for valid formats', () => {
    expect(isValidFormat('table')).toBe(true);
    expect(isValidFormat('json')).toBe(true);
    expect(isValidFormat('csv')).toBe(true);
  });

  it('should return false for invalid formats', () => {
    expect(isValidFormat('xml')).toBe(false);
    expect(isValidFormat('yaml')).toBe(false);
    expect(isValidFormat('')).toBe(false);
    expect(isValidFormat('TABLE')).toBe(false);
  });
});

describe('SUPPORTED_FORMATS', () => {
  it('should contain all supported formats', () => {
    expect(SUPPORTED_FORMATS).toContain('table');
    expect(SUPPORTED_FORMATS).toContain('json');
    expect(SUPPORTED_FORMATS).toContain('csv');
    expect(SUPPORTED_FORMATS).toHaveLength(3);
  });
});
