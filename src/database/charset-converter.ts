/**
 * Oracle 캐릭터셋 변환 모듈
 *
 * @description
 * US7ASCII 등 레거시 캐릭터셋을 사용하는 Oracle 환경에서
 * MS949(EUC-KR) 등으로 저장된 한글 데이터를 올바르게 디코딩합니다.
 *
 * 읽기 경로 (UTL_RAW.CAST_TO_RAW 기반):
 * 1. SELECT 시 UTL_RAW.CAST_TO_RAW(column) 으로 RAW 타입 반환
 * 2. oracledb가 RAW → Buffer 전달 (charset 변환 없음)
 * 3. iconv-lite로 실제 캐릭터셋(ms949 등) 디코딩
 *
 * 쓰기 경로:
 * 1. UTF-8 문자열을 실제 캐릭터셋으로 인코딩
 * 2. hex 문자열로 변환하여 UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(:hex)) 패턴 사용
 *
 * @module database/charset-converter
 */

import iconv from 'iconv-lite';
import { logger } from '../logger/index.js';

/**
 * 문자열이 순수 ASCII(0x00-0x7F)인지 확인합니다.
 * ASCII 문자열은 변환이 불필요하므로 빠르게 건너뜁니다.
 *
 * @param str - 검사할 문자열
 * @returns 모든 문자가 ASCII 범위 내이면 true
 */
export function isPureAscii(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) >= 0x80) return false;
  }
  return true;
}

/**
 * Oracle에서 읽어온 값을 올바른 캐릭터셋으로 디코딩합니다.
 *
 * @description
 * UTL_RAW.CAST_TO_RAW() 적용 컬럼은 Buffer로 도착하며,
 * iconv-lite로 실제 캐릭터셋(ms949 등)으로 디코딩합니다.
 * string 입력은 CAST_TO_RAW 미적용 컬럼이므로 변환 없이 통과합니다.
 *
 * @param value - Buffer(RAW) 또는 string
 * @param charset - 실제 데이터 인코딩 (예: 'ms949', 'euc-kr')
 * @returns 올바르게 디코딩된 UTF-8 문자열 또는 원본 값
 */
export function convertOracleCharset(
  value: string | Buffer<ArrayBuffer>,
  charset: string
): string | Buffer<ArrayBuffer> {
  if (Buffer.isBuffer(value) && charset) {
    return iconv.decode(value, charset);
  }

  return value;
}

/**
 * UTF-8 문자열을 Oracle US7ASCII DB에 저장하기 위해 인코딩합니다.
 * UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(:hex)) 패턴에 사용할 hex 문자열을 반환합니다.
 *
 * @param value - UTF-8 문자열
 * @param charset - 대상 인코딩 (예: 'ms949', 'euc-kr')
 * @returns 순수 ASCII면 원본 문자열, 아니면 hex 인코딩된 문자열
 */
export function encodeForOracle(value: string, charset: string): string {
  if (!value || !charset || isPureAscii(value)) return value;
  const encoded = iconv.encode(value, charset);
  return encoded.toString('hex').toUpperCase();
}

/**
 * 중첩된 값의 모든 문자열에 캐릭터셋 변환을 재귀 적용합니다.
 * null, undefined, 숫자, boolean, Date, Buffer는 그대로 통과합니다.
 *
 * @param value - 변환할 값 (원시값, 객체, 배열)
 * @param charset - 실제 데이터 인코딩
 * @returns 문자열이 변환된 값
 */
export function convertDeep(value: unknown, charset: string): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value;
  }

  if (Buffer.isBuffer(value) && value.buffer instanceof ArrayBuffer) {
    return convertOracleCharset(value as Buffer<ArrayBuffer>, charset);
  }

  if (Array.isArray(value)) {
    return value.map((item) => convertDeep(item, charset));
  }

  if (value instanceof Date) return value;

  if (typeof value === 'object') {
    const converted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(
      value as Record<string, unknown>
    )) {
      converted[key] = convertDeep(val, charset);
    }
    return converted;
  }

  return value;
}

/**
 * Knex postProcessResponse 콜백을 생성하는 팩토리 함수입니다.
 * 지원하지 않는 캐릭터셋이면 변환 없이 통과시키는 identity 함수를 반환합니다.
 *
 * @param charset - 실제 데이터 인코딩 (예: 'ms949', 'euc-kr')
 * @returns Knex postProcessResponse 콜백
 */
export function createPostProcessResponse(
  charset: string
): (result: unknown) => unknown {
  if (!iconv.encodingExists(charset)) {
    logger.error(
      `Unsupported charset: ${charset}. Charset conversion disabled.`
    );
    return (result: unknown) => result;
  }

  logger.info(`Oracle charset conversion enabled: ${charset}`);

  return (result: unknown) => convertDeep(result, charset);
}

/**
 * 쿼리 결과 행 배열에 캐릭터셋 변환을 적용합니다.
 * schema-loader의 ResultSet 경로 등에서 사용합니다.
 *
 * @param rows - 변환할 행 배열
 * @param charset - 실제 데이터 인코딩
 * @returns 변환된 행 배열
 */
export function convertResultRows<T>(rows: T[], charset: string): T[] {
  return rows.map((row) => convertDeep(row, charset) as T);
}
