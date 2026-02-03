/**
 * 입력 검증 모듈
 *
 * @description
 * 자연어 입력의 길이, 형식을 검증하고 프롬프트 인젝션 패턴을 감지합니다.
 * SQL 인젝션과는 별개로 AI 프롬프트에 대한 보안을 담당합니다.
 *
 * @module utils/input-validator
 */

/**
 * 입력 검증 결과
 */
export interface InputValidationResult {
  /** 검증 통과 여부 */
  valid: boolean;
  /** 정제된 입력 문자열 */
  sanitized: string;
  /** 검증 실패 시 에러 메시지 */
  error?: string;
}

/**
 * 입력 검증 설정
 */
export interface InputValidationOptions {
  /** 최대 입력 길이 (기본값: 2000) */
  maxLength?: number;
  /** 최소 입력 길이 (기본값: 1) */
  minLength?: number;
  /** 프롬프트 인젝션 검사 여부 (기본값: true) */
  checkPromptInjection?: boolean;
}

/**
 * 프롬프트 인젝션 패턴 목록
 * AI 모델의 동작을 조작하려는 시도를 감지
 */
const PROMPT_INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // 역할 변경 시도
  { pattern: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?)/i, reason: 'Prompt injection: ignore instructions pattern' },
  { pattern: /disregard\s+(all\s+)?(previous|above|prior)/i, reason: 'Prompt injection: disregard pattern' },
  { pattern: /forget\s+(everything|all|your)\s+(you|instructions?|training)/i, reason: 'Prompt injection: forget instructions pattern' },

  // 시스템 프롬프트 추출 시도
  { pattern: /show\s+(me\s+)?(your|the)\s+(system\s+)?prompt/i, reason: 'Prompt injection: show prompt pattern' },
  { pattern: /reveal\s+(your|the)\s+(system\s+)?prompt/i, reason: 'Prompt injection: reveal prompt pattern' },
  { pattern: /what\s+(is|are)\s+your\s+(system\s+)?(instructions?|prompts?)/i, reason: 'Prompt injection: extract instructions pattern' },

  // 역할 재정의 시도
  { pattern: /you\s+are\s+now\s+(a|an|the)/i, reason: 'Prompt injection: role redefinition pattern' },
  { pattern: /act\s+as\s+(if\s+you\s+are|a|an)/i, reason: 'Prompt injection: role change pattern' },
  { pattern: /pretend\s+(you\s+are|to\s+be)/i, reason: 'Prompt injection: pretend pattern' },

  // 제한 해제 시도
  { pattern: /bypass\s+(your\s+)?(restrictions?|limitations?|filters?)/i, reason: 'Prompt injection: bypass restrictions pattern' },
  { pattern: /jailbreak/i, reason: 'Prompt injection: jailbreak keyword' },
  { pattern: /DAN\s+mode/i, reason: 'Prompt injection: DAN mode pattern' },

  // 코드 인젝션 시도
  { pattern: /```\s*system/i, reason: 'Prompt injection: system code block pattern' },
  { pattern: /\[\[system\]\]/i, reason: 'Prompt injection: system tag pattern' },
  { pattern: /<\s*system\s*>/i, reason: 'Prompt injection: system XML tag pattern' },
];

/**
 * 특수 문자 이스케이프
 * AI 프롬프트에서 문제가 될 수 있는 문자를 정규화
 */
function escapeSpecialCharacters(input: string): string {
  // 제어 문자 제거 (탭, 개행은 공백으로 변환)
  // eslint-disable-next-line no-control-regex
  const controlCharPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
  const sanitized = input
    .replace(controlCharPattern, '') // 제어 문자 제거
    .replace(/[\t\r\n]+/g, ' ') // 탭, 개행을 공백으로
    .replace(/\s+/g, ' ') // 연속 공백 정규화
    .trim();

  return sanitized;
}

/**
 * 프롬프트 인젝션 패턴 감지
 *
 * @param input - 검사할 입력
 * @returns 감지된 패턴이 있으면 에러 메시지, 없으면 null
 */
function detectPromptInjection(input: string): string | null {
  for (const { pattern, reason } of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return reason;
    }
  }
  return null;
}

/**
 * 자연어 입력을 검증합니다.
 *
 * @description
 * 사용자의 자연어 쿼리를 검증하고 정제합니다.
 * 다음 검사를 수행합니다:
 * 1. 입력 길이 검사 (최소/최대)
 * 2. 특수 문자 이스케이프
 * 3. 프롬프트 인젝션 패턴 감지
 *
 * @param input - 검증할 자연어 입력
 * @param options - 검증 옵션
 * @returns 검증 결과
 *
 * @example
 * const result = validateNaturalLanguageInput('사용자 목록 보여줘');
 * if (result.valid) {
 *   console.log('Sanitized:', result.sanitized);
 * } else {
 *   console.error('Error:', result.error);
 * }
 */
export function validateNaturalLanguageInput(
  input: string,
  options: InputValidationOptions = {}
): InputValidationResult {
  const {
    maxLength = 2000,
    minLength = 1,
    checkPromptInjection = true,
  } = options;

  // 1. null/undefined 체크
  if (input === null || input === undefined) {
    return {
      valid: false,
      sanitized: '',
      error: 'Input is required',
    };
  }

  // 2. 문자열 타입 확인
  if (typeof input !== 'string') {
    return {
      valid: false,
      sanitized: '',
      error: 'Input must be a string',
    };
  }

  // 3. 특수 문자 이스케이프 및 정규화
  const sanitized = escapeSpecialCharacters(input);

  // 4. 최소 길이 검사
  if (sanitized.length < minLength) {
    return {
      valid: false,
      sanitized,
      error: `Input is too short (minimum ${minLength} characters)`,
    };
  }

  // 5. 최대 길이 검사
  if (sanitized.length > maxLength) {
    return {
      valid: false,
      sanitized: sanitized.substring(0, maxLength),
      error: `Input is too long (maximum ${maxLength} characters)`,
    };
  }

  // 6. 프롬프트 인젝션 감지
  if (checkPromptInjection) {
    const injectionError = detectPromptInjection(sanitized);
    if (injectionError) {
      return {
        valid: false,
        sanitized,
        error: injectionError,
      };
    }
  }

  return {
    valid: true,
    sanitized,
  };
}

/**
 * 입력의 안전성만 빠르게 확인합니다.
 *
 * @param input - 검사할 입력
 * @returns 안전하면 true
 *
 * @example
 * if (isInputSafe(userQuery)) {
 *   processQuery(userQuery);
 * }
 */
export function isInputSafe(input: string): boolean {
  const result = validateNaturalLanguageInput(input);
  return result.valid;
}
