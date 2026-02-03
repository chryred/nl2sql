/**
 * response-parser.ts 유닛 테스트
 */

import { parseSQL, validateSQL, detectDangerousSQL } from '../../src/ai/response-parser.js';

describe('parseSQL', () => {
  it('should remove markdown code blocks', () => {
    const input = '```sql\nSELECT * FROM users;\n```';
    expect(parseSQL(input)).toBe('SELECT * FROM users;');
  });

  it('should remove backticks', () => {
    const input = '`SELECT * FROM users`';
    expect(parseSQL(input)).toBe('SELECT * FROM users;');
  });

  it('should normalize whitespace', () => {
    const input = 'SELECT\n  *\n  FROM\n  users';
    expect(parseSQL(input)).toBe('SELECT * FROM users;');
  });

  it('should add semicolon if missing', () => {
    const input = 'SELECT * FROM users';
    expect(parseSQL(input)).toBe('SELECT * FROM users;');
  });

  it('should not add extra semicolon', () => {
    const input = 'SELECT * FROM users;';
    expect(parseSQL(input)).toBe('SELECT * FROM users;');
  });
});

describe('detectDangerousSQL', () => {
  describe('dangerous keywords', () => {
    it('should detect DROP statement', () => {
      const result = detectDangerousSQL('DROP TABLE users;');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('DROP');
    });

    it('should detect DELETE statement', () => {
      const result = detectDangerousSQL('DELETE FROM users WHERE id = 1;');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('DELETE');
    });

    it('should detect TRUNCATE statement', () => {
      const result = detectDangerousSQL('TRUNCATE TABLE users;');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('TRUNCATE');
    });

    it('should detect ALTER statement', () => {
      const result = detectDangerousSQL('ALTER TABLE users ADD COLUMN email VARCHAR(255);');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('ALTER');
    });
  });

  describe('dangerous patterns', () => {
    it('should detect SQL comments (--)', () => {
      const result = detectDangerousSQL('SELECT * FROM users WHERE id = 1 -- comment');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('comment');
    });

    it('should detect block comments (/*)', () => {
      const result = detectDangerousSQL('SELECT * FROM users /* comment */');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Block comment');
    });

    it('should detect UNION SELECT injection', () => {
      const result = detectDangerousSQL("SELECT * FROM users UNION SELECT * FROM passwords");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('UNION SELECT');
    });

    it('should detect INTO OUTFILE', () => {
      const result = detectDangerousSQL("SELECT * INTO OUTFILE '/tmp/data.txt' FROM users");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('OUTFILE');
    });

    it('should detect LOAD_FILE', () => {
      const result = detectDangerousSQL("SELECT LOAD_FILE('/etc/passwd')");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('LOAD_FILE');
    });

    it('should detect SLEEP function', () => {
      const result = detectDangerousSQL("SELECT * FROM users WHERE id = 1 AND SLEEP(5)");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('SLEEP');
    });

    it('should detect BENCHMARK function', () => {
      const result = detectDangerousSQL("SELECT BENCHMARK(10000000, SHA1('test'))");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('BENCHMARK');
    });

    it('should detect multiple statements with DROP', () => {
      const result = detectDangerousSQL('SELECT * FROM users; DROP TABLE users;');
      expect(result.safe).toBe(false);
    });
  });

  describe('safe patterns', () => {
    it('should allow SELECT statement', () => {
      const result = detectDangerousSQL('SELECT * FROM users WHERE id = 1;');
      expect(result.safe).toBe(true);
    });

    it('should allow INSERT statement', () => {
      const result = detectDangerousSQL("INSERT INTO users (name) VALUES ('John');");
      expect(result.safe).toBe(true);
    });

    it('should allow UPDATE statement', () => {
      const result = detectDangerousSQL("UPDATE users SET name = 'Jane' WHERE id = 1;");
      expect(result.safe).toBe(true);
    });

    it('should allow WITH (CTE) statement', () => {
      const result = detectDangerousSQL('WITH cte AS (SELECT * FROM users) SELECT * FROM cte;');
      expect(result.safe).toBe(true);
    });
  });
});

describe('validateSQL', () => {
  it('should validate valid SELECT statement', () => {
    const result = validateSQL('SELECT * FROM users;');
    expect(result.valid).toBe(true);
  });

  it('should validate valid INSERT statement', () => {
    const result = validateSQL("INSERT INTO users (name) VALUES ('John');");
    expect(result.valid).toBe(true);
  });

  it('should validate valid UPDATE statement', () => {
    const result = validateSQL("UPDATE users SET name = 'Jane' WHERE id = 1;");
    expect(result.valid).toBe(true);
  });

  it('should reject DROP statement', () => {
    const result = validateSQL('DROP TABLE users;');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('DROP');
  });

  it('should reject DELETE statement', () => {
    const result = validateSQL('DELETE FROM users;');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('DELETE');
  });

  it('should reject invalid statement keyword', () => {
    const result = validateSQL('INVALID STATEMENT;');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('valid statement keyword');
  });

  it('should detect unbalanced parentheses', () => {
    const result = validateSQL('SELECT * FROM users WHERE (id = 1;');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('parentheses');
  });
});
