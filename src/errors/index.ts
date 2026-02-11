/**
 * NL2SQL 커스텀 에러 클래스 모듈
 *
 * @description
 * 애플리케이션 전체에서 사용되는 에러 클래스를 정의합니다.
 * 각 에러는 사용자 친화적 메시지와 에러 코드를 포함합니다.
 *
 * @module errors
 */

/**
 * NL2SQL 기본 에러 클래스
 *
 * @description
 * 모든 커스텀 에러의 기본 클래스입니다.
 * 에러 코드와 사용자 친화적 메시지를 포함합니다.
 */
export class NL2SQLError extends Error {
  /**
   * @param message - 개발자용 상세 에러 메시지
   * @param code - 에러 코드 (예: 'DB_CONNECTION_FAILED')
   * @param userMessage - 사용자에게 표시할 메시지
   */
  constructor(
    message: string,
    public readonly code: string,
    public readonly userMessage: string
  ) {
    super(message);
    this.name = 'NL2SQLError';
    // Error 프로토타입 체인 복원 (TypeScript 컴파일 시 필요)
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * 사용자에게 표시할 메시지를 반환합니다.
   * production 환경에서는 이 메시지만 표시해야 합니다.
   */
  toUserMessage(): string {
    return this.userMessage;
  }

  /**
   * 에러를 JSON 형식으로 직렬화합니다.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
    };
  }
}

/**
 * 데이터베이스 연결 에러
 *
 * @description
 * 데이터베이스 연결 실패 시 발생합니다.
 */
export class DatabaseConnectionError extends NL2SQLError {
  constructor(
    message: string,
    public readonly host?: string,
    public readonly port?: number,
    public readonly database?: string
  ) {
    super(
      message,
      'DB_CONNECTION_FAILED',
      '데이터베이스에 연결할 수 없습니다. 연결 설정을 확인하세요.'
    );
    this.name = 'DatabaseConnectionError';
  }
}

/**
 * 데이터베이스 쿼리 에러
 *
 * @description
 * SQL 쿼리 실행 중 발생하는 에러입니다.
 */
export class DatabaseQueryError extends NL2SQLError {
  constructor(
    message: string,
    public readonly query?: string,
    public readonly originalError?: Error
  ) {
    super(
      message,
      'DB_QUERY_FAILED',
      '쿼리를 실행할 수 없습니다. SQL 문법을 확인하고 다시 시도하세요.'
    );
    this.name = 'DatabaseQueryError';
  }
}

/**
 * SQL 검증 에러
 *
 * @description
 * 생성된 SQL이 유효하지 않거나 위험한 패턴을 포함할 때 발생합니다.
 */
export class SQLValidationError extends NL2SQLError {
  constructor(
    message: string,
    public readonly sql?: string,
    public readonly validationReason?: string
  ) {
    super(
      message,
      'SQL_VALIDATION_FAILED',
      '생성된 SQL을 검증할 수 없습니다. 쿼리를 다시 작성해 보세요.'
    );
    this.name = 'SQLValidationError';
  }
}

/**
 * SQL 보안 에러
 *
 * @description
 * 위험한 SQL 패턴이 감지되었을 때 발생합니다.
 */
export class SQLSecurityError extends NL2SQLError {
  constructor(
    message: string,
    public readonly pattern?: string
  ) {
    super(
      message,
      'SQL_SECURITY_VIOLATION',
      '위험한 SQL 패턴이 감지되었습니다. 이 작업은 허용되지 않습니다.'
    );
    this.name = 'SQLSecurityError';
  }
}

/**
 * AI 제공자 에러
 *
 * @description
 * AI API 호출 실패 시 발생합니다.
 */
export class AIProviderError extends NL2SQLError {
  constructor(
    message: string,
    public readonly provider: 'openai' | 'anthropic',
    public readonly statusCode?: number,
    public readonly originalError?: Error
  ) {
    super(
      message,
      'AI_PROVIDER_ERROR',
      'SQL 생성에 실패했습니다. AI 서비스가 일시적으로 사용 불가능할 수 있습니다.'
    );
    this.name = 'AIProviderError';
  }
}

/**
 * 설정 에러
 *
 * @description
 * 잘못된 설정 또는 누락된 설정이 있을 때 발생합니다.
 */
export class ConfigurationError extends NL2SQLError {
  constructor(
    message: string,
    public readonly configKey?: string
  ) {
    super(
      message,
      'CONFIGURATION_ERROR',
      '설정 오류입니다. 환경 변수 또는 설정 파일을 확인하세요.'
    );
    this.name = 'ConfigurationError';
  }
}

/**
 * 입력 검증 에러
 *
 * @description
 * 사용자 입력이 유효하지 않을 때 발생합니다.
 */
export class InputValidationError extends NL2SQLError {
  constructor(
    message: string,
    public readonly input?: string
  ) {
    super(message, 'INPUT_VALIDATION_FAILED', message); // 입력 에러는 사용자에게 그대로 표시
    this.name = 'InputValidationError';
  }
}

/**
 * 스키마 추출 에러
 *
 * @description
 * 데이터베이스 스키마 추출 실패 시 발생합니다.
 */
export class SchemaExtractionError extends NL2SQLError {
  constructor(
    message: string,
    public readonly tableName?: string
  ) {
    super(
      message,
      'SCHEMA_EXTRACTION_FAILED',
      '데이터베이스 스키마 추출에 실패했습니다. 데이터베이스 권한을 확인하세요.'
    );
    this.name = 'SchemaExtractionError';
  }
}

/**
 * 민감 정보 마스킹 유틸리티
 *
 * @description
 * 에러 메시지에서 민감한 정보를 마스킹합니다.
 *
 * @param message - 원본 메시지
 * @returns 마스킹된 메시지
 */
export function maskSensitiveInfo(message: string): string {
  let masked = message;

  // API 키 마스킹 (sk-ant-xxx... 형식) - Anthropic 먼저 처리
  masked = masked.replace(
    /sk-ant-[a-zA-Z0-9-]{10,}/g,
    (match) => `${match.substring(0, 7)}***`
  );

  // API 키 마스킹 (sk-xxx... 형식) - OpenAI
  masked = masked.replace(
    /sk-[a-zA-Z0-9]{10,}/g,
    (match) => `${match.substring(0, 5)}***`
  );

  // IP 주소 마스킹 (호스트 정보)
  masked = masked.replace(
    /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g,
    '$1.***.***.$4'
  );

  // 호스트명 마스킹 (localhost 제외)
  // - 2+ 세그먼트 (a.b.c) 형태는 항상 마스킹
  // - 1 세그먼트 (a.b) 형태는 포트(:숫자)나 경로(/)가 뒤따를 때만 마스킹
  // - 스키마명.테이블명 (예: ADMIN.STORES) 오탐 방지
  masked = masked.replace(
    /(?<!@)(?:([a-zA-Z0-9][-a-zA-Z0-9]*\.){2,}[a-zA-Z]{2,}(?=:\d|\/|$|\s)|([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(?=:\d|\/))/g,
    (match) => {
      if (match === 'localhost' || match === '127.0.0.1') return match;
      const parts = match.split('.');
      if (parts.length >= 2) {
        return `${parts[0][0]}***.${parts[parts.length - 1]}`;
      }
      return `${match[0]}***`;
    }
  );

  // 비밀번호 패턴 마스킹 (password=xxx 형식)
  masked = masked.replace(/(password\s*[=:]\s*)['"]?[^'"\s]+['"]?/gi, '$1***');

  // 포트 번호는 유지 (디버깅에 유용)

  return masked;
}

/**
 * 환경에 따른 에러 메시지 반환
 *
 * @param error - 에러 객체
 * @returns 환경에 맞는 에러 메시지
 */
export function getErrorMessage(error: unknown): string {
  const isProduction = process.env.NODE_ENV === 'production';

  if (error instanceof NL2SQLError) {
    if (isProduction) {
      return error.toUserMessage();
    }
    return maskSensitiveInfo(error.message);
  }

  if (error instanceof Error) {
    if (isProduction) {
      return '예기치 않은 오류가 발생했습니다. 다시 시도하세요.';
    }
    return maskSensitiveInfo(error.message);
  }

  return '알 수 없는 오류가 발생했습니다.';
}
