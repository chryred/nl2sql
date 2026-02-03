/**
 * 쿼리 결과 포맷터 모듈
 *
 * @description
 * 쿼리 결과를 다양한 형식으로 포맷팅합니다.
 * table, json, csv 형식을 지원합니다.
 *
 * @module cli/formatters/result-formatter
 */

/**
 * 출력 형식 타입
 */
export type OutputFormat = 'table' | 'json' | 'csv';

/**
 * 쿼리 결과 행 타입
 */
export type ResultRow = Record<string, unknown>;

/**
 * 값을 CSV 안전 문자열로 변환합니다.
 *
 * @param value - 변환할 값
 * @returns CSV 안전 문자열
 */
function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const strValue = String(value);

  // 쉼표, 큰따옴표, 개행이 포함된 경우 큰따옴표로 감싸기
  if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
    // 큰따옴표는 두 개로 이스케이프
    return `"${strValue.replace(/"/g, '""')}"`;
  }

  return strValue;
}

/**
 * 결과를 CSV 형식으로 포맷팅합니다.
 *
 * @param results - 쿼리 결과 배열
 * @returns CSV 문자열
 */
function formatAsCSV(results: ResultRow[]): string {
  if (results.length === 0) {
    return '';
  }

  // 헤더 추출
  const headers = Object.keys(results[0]);

  // 헤더 행
  const headerRow = headers.map(escapeCSVValue).join(',');

  // 데이터 행
  const dataRows = results.map((row) =>
    headers.map((header) => escapeCSVValue(row[header])).join(',')
  );

  return [headerRow, ...dataRows].join('\n');
}

/**
 * 결과를 JSON 형식으로 포맷팅합니다.
 *
 * @param results - 쿼리 결과 배열
 * @returns JSON 문자열 (pretty-printed)
 */
function formatAsJSON(results: ResultRow[]): string {
  return JSON.stringify(results, null, 2);
}

/**
 * 결과를 테이블 형식으로 포맷팅합니다.
 *
 * @description
 * console.table과 유사하지만 문자열로 반환합니다.
 * 컬럼 너비를 자동으로 조정합니다.
 *
 * @param results - 쿼리 결과 배열
 * @returns 테이블 문자열
 */
function formatAsTable(results: ResultRow[]): string {
  if (results.length === 0) {
    return '(empty)';
  }

  const headers = Object.keys(results[0]);

  // 각 컬럼의 최대 너비 계산
  const columnWidths: Record<string, number> = {};
  for (const header of headers) {
    columnWidths[header] = header.length;
  }

  for (const row of results) {
    for (const header of headers) {
      const value = String(row[header] ?? '');
      // 너비는 최대 50자로 제한
      const width = Math.min(value.length, 50);
      if (width > columnWidths[header]) {
        columnWidths[header] = width;
      }
    }
  }

  // 헤더 행 생성
  const headerRow = headers
    .map((h) => h.padEnd(columnWidths[h]))
    .join(' | ');

  // 구분선 생성
  const separator = headers
    .map((h) => '-'.repeat(columnWidths[h]))
    .join('-+-');

  // 데이터 행 생성
  const dataRows = results.map((row) =>
    headers
      .map((h) => {
        const value = String(row[h] ?? '');
        // 긴 값은 잘라내기
        const truncated =
          value.length > 50 ? value.substring(0, 47) + '...' : value;
        return truncated.padEnd(columnWidths[h]);
      })
      .join(' | ')
  );

  return [headerRow, separator, ...dataRows].join('\n');
}

/**
 * 쿼리 결과를 지정된 형식으로 포맷팅합니다.
 *
 * @param results - 쿼리 결과 배열
 * @param format - 출력 형식 (table, json, csv)
 * @returns 포맷팅된 문자열
 *
 * @example
 * const results = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
 *
 * // 테이블 형식
 * console.log(formatResults(results, 'table'));
 *
 * // JSON 형식
 * console.log(formatResults(results, 'json'));
 *
 * // CSV 형식
 * console.log(formatResults(results, 'csv'));
 */
export function formatResults(
  results: unknown[],
  format: OutputFormat = 'table'
): string {
  const rows = results as ResultRow[];

  switch (format) {
    case 'json':
      return formatAsJSON(rows);
    case 'csv':
      return formatAsCSV(rows);
    case 'table':
    default:
      return formatAsTable(rows);
  }
}

/**
 * 지원되는 출력 형식 목록
 */
export const SUPPORTED_FORMATS: OutputFormat[] = ['table', 'json', 'csv'];

/**
 * 출력 형식이 유효한지 확인합니다.
 *
 * @param format - 확인할 형식
 * @returns 유효하면 true
 */
export function isValidFormat(format: string): format is OutputFormat {
  return SUPPORTED_FORMATS.includes(format as OutputFormat);
}
