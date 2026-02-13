/**
 * Oracle 드라이버 초기화 모듈
 *
 * @description
 * US7ASCII 등 레거시 캐릭터셋을 사용하는 Oracle 환경에서
 * 한글(MS949/EUC-KR) 등 다중 바이트 문자를 올바르게 읽기 위해
 * Thick 모드 + WE8ISO8859P1 클라이언트 캐릭터셋을 설정합니다.
 *
 * 동작 원리:
 * 1. NLS_LANG='.WE8ISO8859P1' 설정으로 Oracle Client가 Latin1 바이트 패스스루 수행
 * 2. oracledb Thick 모드 초기화로 Oracle Client 라이브러리 활성화
 * 3. charset-converter.ts에서 Latin1 → 실제 캐릭터셋(ms949 등) 디코딩
 *
 * @module database/oracle-driver-setup
 */

import { logger } from '../logger/index.js';

/** Oracle 드라이버 초기화 옵션 */
export interface OracleDriverOptions {
  /** 클라이언트 모드: 'thin' | 'thick' | 'auto' (기본값: 'auto') */
  clientMode?: string;
  /** Oracle Instant Client 라이브러리 경로 */
  oracleClientPath?: string;
  /** 데이터 캐릭터셋 (예: ms949, euc-kr) - 설정 시 Thick 모드 시도 */
  oracleDataCharset?: string;
}

/** 초기화 완료 여부 */
let initialized = false;

/** Thick 모드 활성화 여부 */
let thickModeActive = false;

/**
 * Oracle 드라이버를 초기화합니다.
 *
 * @description
 * oracleDataCharset가 설정된 경우 Thick 모드를 시도합니다.
 * Thick 모드에서는 NLS_LANG을 WE8ISO8859P1로 설정하여
 * Oracle Client가 바이트를 Latin1으로 투명 전달하도록 합니다.
 *
 * initOracleClient()는 프로세스당 1회만 호출 가능하므로
 * 중복 호출을 방지합니다.
 *
 * @param options - 드라이버 초기화 옵션
 * @returns Thick 모드 활성화 여부
 */
export async function initializeOracleDriver(
  options: OracleDriverOptions
): Promise<boolean> {
  if (initialized) return thickModeActive;

  // oracleDataCharset 미설정 시 초기화 불필요
  if (!options.oracleDataCharset) {
    initialized = true;
    return false;
  }

  const mode = options.clientMode || 'auto';

  // Thin 모드 명시적 선택
  if (mode === 'thin') {
    logger.warn(
      'Oracle Thin mode selected with oracleDataCharset. ' +
        'Korean/CJK text from US7ASCII databases may be garbled. ' +
        'Use thick or auto mode with Oracle Instant Client for proper charset conversion.'
    );
    initialized = true;
    return false;
  }

  // NLS_LANG 설정 (반드시 oracledb import/초기화 전에)
  process.env.NLS_LANG = '.WE8ISO8859P1';

  try {
    // @ts-expect-error -- oracledb is an optional dependency without bundled types
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const oracledb = await import('oracledb');
    const initOptions: { libDir?: string } = {};

    if (options.oracleClientPath) {
      initOptions.libDir = options.oracleClientPath;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    oracledb.default.initOracleClient(initOptions);
    thickModeActive = true;
    logger.info(
      `Oracle Thick mode initialized with WE8ISO8859P1 client charset (data charset: ${options.oracleDataCharset})`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (mode === 'thick') {
      throw new Error(
        `Oracle Thick mode initialization failed: ${msg}. ` +
          'Install Oracle Instant Client or set ORACLE_CLIENT_PATH.'
      );
    }

    // auto 모드: Thick 실패 → Thin fallback + 경고
    logger.warn(
      `Oracle Thick mode unavailable (${msg}). ` +
        'Falling back to Thin mode. ' +
        'Korean/CJK charset conversion may not work correctly. ' +
        'Install Oracle Instant Client for proper Korean support.'
    );
  }

  initialized = true;
  return thickModeActive;
}

/**
 * Thick 모드 활성화 여부를 반환합니다.
 *
 * @returns Thick 모드가 활성화되어 있으면 true
 */
export function isThickModeActive(): boolean {
  return thickModeActive;
}
