/**
 * 위험한 SQL 키워드 목록
 * INSERT와 UPDATE는 허용하되, 데이터 삭제/구조 변경은 차단
 */
const DANGEROUS_KEYWORDS = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER'] as const;

/**
 * SQL 인젝션 및 위험 패턴
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /--/, reason: 'SQL comment (--) detected' },
  { pattern: /\/\*/, reason: 'Block comment (/*) detected' },
  {
    pattern: /;\s*(DROP|DELETE|TRUNCATE|ALTER)/i,
    reason: 'Multiple statements with dangerous command detected',
  },
  {
    pattern: /UNION\s+(ALL\s+)?SELECT/i,
    reason: 'UNION SELECT injection pattern detected',
  },
  {
    pattern: /INTO\s+OUTFILE/i,
    reason: 'File write operation (INTO OUTFILE) detected',
  },
  {
    pattern: /INTO\s+DUMPFILE/i,
    reason: 'File write operation (INTO DUMPFILE) detected',
  },
  {
    pattern: /LOAD_FILE\s*\(/i,
    reason: 'File read operation (LOAD_FILE) detected',
  },
  { pattern: /LOAD\s+DATA\s+/i, reason: 'Data loading operation detected' },
  {
    pattern: /xp_cmdshell/i,
    reason: 'Command execution (xp_cmdshell) detected',
  },
  { pattern: /EXEC(\s+|\()/i, reason: 'EXEC command detected' },
  { pattern: /EXECUTE\s+/i, reason: 'EXECUTE command detected' },
  { pattern: /0x[0-9a-fA-F]+/, reason: 'Hexadecimal string detected' },
  {
    pattern: /CHAR\s*\(\s*\d+\s*\)/i,
    reason: 'CHAR() function with numeric argument detected',
  },
  {
    pattern: /BENCHMARK\s*\(/i,
    reason: 'BENCHMARK function detected (potential DoS)',
  },
  { pattern: /SLEEP\s*\(/i, reason: 'SLEEP function detected (potential DoS)' },
  {
    pattern: /WAITFOR\s+DELAY/i,
    reason: 'WAITFOR DELAY detected (potential DoS)',
  },
];

/**
 * 위험한 SQL 패턴 감지 결과
 */
export interface DangerousPatternResult {
  safe: boolean;
  reason?: string;
}

/**
 * SQL 문에서 위험한 패턴을 감지합니다.
 *
 * @param sql - 검사할 SQL 문
 * @returns 안전 여부와 위험 이유
 *
 * @example
 * const result = detectDangerousSQL('DROP TABLE users;');
 * // { safe: false, reason: 'Dangerous keyword detected: DROP' }
 */
export function detectDangerousSQL(sql: string): DangerousPatternResult {
  // 위험한 키워드 확인 (문장 시작 또는 세미콜론 뒤에 오는 경우)
  for (const keyword of DANGEROUS_KEYWORDS) {
    // 문장 시작에서 위험 키워드 확인
    const startsWithDangerous = new RegExp(`^\\s*${keyword}\\b`, 'i');
    if (startsWithDangerous.test(sql)) {
      return { safe: false, reason: `Dangerous keyword detected: ${keyword}` };
    }

    // 세미콜론 뒤에 위험 키워드 확인 (다중 명령어)
    const afterSemicolon = new RegExp(`;\\s*${keyword}\\b`, 'i');
    if (afterSemicolon.test(sql)) {
      return {
        safe: false,
        reason: `Multiple statements with dangerous command: ${keyword}`,
      };
    }
  }

  // 위험한 패턴 확인
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(sql)) {
      return { safe: false, reason };
    }
  }

  return { safe: true };
}

export function parseSQL(response: string): string {
  let sql = response.trim();

  // Remove markdown code blocks if present
  const codeBlockMatch = sql.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    sql = codeBlockMatch[1].trim();
  }

  // Remove leading/trailing backticks
  sql = sql.replace(/^`+|`+$/g, '');

  // Normalize whitespace
  sql = sql.replace(/\s+/g, ' ').trim();

  // Ensure it ends with semicolon
  if (!sql.endsWith(';')) {
    sql += ';';
  }

  return sql;
}

export function validateSQL(sql: string): { valid: boolean; error?: string } {
  const trimmed = sql.trim().toUpperCase();

  // 1. 위험한 SQL 패턴 검사 (보안)
  const dangerCheck = detectDangerousSQL(sql);
  if (!dangerCheck.safe) {
    return { valid: false, error: dangerCheck.reason };
  }

  // 2. 기본 검증 - 허용된 SQL 키워드로 시작하는지 확인
  // INSERT, UPDATE는 허용하되 DROP, DELETE, TRUNCATE, ALTER는 위에서 이미 차단됨
  const hasValidStart = /^(SELECT|INSERT|UPDATE|WITH|CREATE)/i.test(trimmed);
  if (!hasValidStart) {
    return {
      valid: false,
      error:
        'SQL must start with a valid statement keyword (SELECT, INSERT, UPDATE, WITH, CREATE)',
    };
  }

  // 3. Check for balanced parentheses
  let parenCount = 0;
  for (const char of sql) {
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (parenCount < 0) {
      return { valid: false, error: 'Unbalanced parentheses' };
    }
  }
  if (parenCount !== 0) {
    return { valid: false, error: 'Unbalanced parentheses' };
  }

  return { valid: true };
}
