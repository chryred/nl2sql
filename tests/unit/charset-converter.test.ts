/**
 * charset-converter.ts 유닛 테스트
 *
 * resolveOracleTextBind, resolveOracleNaturalQuerySelect 헬퍼 함수 테스트
 */

import {
  resolveOracleTextBind,
  resolveOracleNaturalQuerySelect,
} from '../../src/database/charset-converter.js';

describe('resolveOracleTextBind', () => {
  it('should replace {{BIND_TEXT}} with ? when no charset', () => {
    const sql = 'INSERT INTO t (a) VALUES ({{BIND_TEXT}})';
    expect(resolveOracleTextBind(sql)).toBe('INSERT INTO t (a) VALUES (?)');
  });

  it('should replace {{BIND_TEXT}} with UTL_RAW pattern when charset provided', () => {
    const sql = 'INSERT INTO t (a) VALUES ({{BIND_TEXT}})';
    const result = resolveOracleTextBind(sql, 'ms949');
    expect(result).toBe('INSERT INTO t (a) VALUES (UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(?)))');
  });

  it('should replace ALL occurrences of {{BIND_TEXT}}', () => {
    const sql = 'SET a = {{BIND_TEXT}}, b = {{BIND_TEXT}}';
    const result = resolveOracleTextBind(sql, 'ms949');
    expect(result.match(/UTL_RAW/g)?.length).toBe(2);
  });

  it('should return sql unchanged when no placeholder exists', () => {
    const sql = 'SELECT * FROM t WHERE id = ?';
    expect(resolveOracleTextBind(sql, 'ms949')).toBe(sql);
  });
});

describe('resolveOracleNaturalQuerySelect', () => {
  it('should replace {{NATURAL_QUERY_SELECT}} with natural_query when no charset', () => {
    const sql = 'SELECT {{NATURAL_QUERY_SELECT}} FROM query_history';
    expect(resolveOracleNaturalQuerySelect(sql)).toBe('SELECT natural_query FROM query_history');
  });

  it('should replace {{NATURAL_QUERY_SELECT}} with UTL_RAW pattern when charset provided', () => {
    const sql = 'SELECT {{NATURAL_QUERY_SELECT}} FROM query_history';
    const result = resolveOracleNaturalQuerySelect(sql, 'ms949');
    expect(result).toBe('SELECT UTL_RAW.CAST_TO_RAW(natural_query) AS natural_query FROM query_history');
  });

  it('should return sql unchanged when no placeholder exists', () => {
    const sql = 'SELECT id, generated_sql FROM query_history';
    expect(resolveOracleNaturalQuerySelect(sql, 'ms949')).toBe(sql);
  });
});
