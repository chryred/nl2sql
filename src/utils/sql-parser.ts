/**
 * SQL 파서 유틸리티
 *
 * @module utils/sql-parser
 */

/**
 * SQL 쿼리에서 참조된 테이블명을 추출합니다.
 *
 * @description
 * FROM, JOIN(모든 유형), UPDATE, INTO 키워드 뒤 테이블명을 추출합니다.
 * - schema.table 형식은 table 부분만 추출
 * - 별칭(alias)은 제거
 * - WITH ... AS (CTE) 이름은 실제 테이블이 아니므로 결과에서 제외
 * - 추출 결과가 없으면 빈 배열 반환 (호출부에서 전체 스키마 fallback 처리)
 *
 * @param sql - 분석할 SQL 쿼리 문자열
 * @returns 추출된 테이블명 배열 (소문자, 중복 제거)
 */
export function extractTablesFromSQL(sql: string): string[] {
  const normalized = sql.replace(/\s+/g, ' ');

  // Step 1: CTE 이름 수집 — 실제 테이블이 아니므로 결과에서 제외
  const cteNames = new Set<string>();
  const cteRe = /\bWITH\s+([\w$]+)\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = cteRe.exec(normalized)) !== null) {
    cteNames.add(m[1].toLowerCase());
  }

  // Step 2: FROM / 모든 JOIN 유형 / UPDATE / INTO 뒤 테이블명 추출
  // schema.table 형식도 캡처 ([\w$]+(?:\.[\w$]+)?)
  const tableRe = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([\w$]+(?:\.[\w$]+)?)/gi;
  const tables = new Set<string>();
  while ((m = tableRe.exec(normalized)) !== null) {
    const raw = m[1];
    // schema.table → table 정규화 (마지막 .뒤 부분만 사용)
    const name = raw.includes('.') ? raw.split('.').pop()! : raw;
    const lower = name.toLowerCase();
    // CTE 이름 제외
    if (!cteNames.has(lower)) {
      tables.add(lower);
    }
  }

  return Array.from(tables);
}
