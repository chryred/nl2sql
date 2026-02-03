/**
 * 로깅 시스템 모듈
 *
 * @description
 * 구조화된 로깅을 제공합니다.
 * 환경변수 LOG_LEVEL로 로그 레벨을 제어할 수 있습니다.
 *
 * @module logger
 *
 * @example
 * import { logger } from './logger';
 *
 * logger.info('Query executed', { query: 'SELECT * FROM users', rows: 10 });
 * logger.error('Failed to connect', new Error('Connection refused'), { host: 'localhost' });
 */

import chalk from 'chalk';
import { maskSensitiveInfo } from '../errors/index.js';

/**
 * 로그 레벨 열거형
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * 로그 레벨 문자열 매핑
 */
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: 'SILENT',
};

/**
 * 환경변수에서 로그 레벨 파싱
 */
function parseLogLevel(level: string | undefined): LogLevel {
  if (!level) return LogLevel.INFO;

  switch (level.toLowerCase()) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
    case 'warning':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    case 'silent':
    case 'none':
      return LogLevel.SILENT;
    default:
      return LogLevel.INFO;
  }
}

/**
 * 로거 설정
 */
export interface LoggerConfig {
  /** 로그 레벨 */
  level?: LogLevel;
  /** 타임스탬프 포함 여부 */
  timestamps?: boolean;
  /** JSON 형식 출력 여부 */
  json?: boolean;
  /** 민감 정보 마스킹 여부 */
  maskSensitive?: boolean;
}

/**
 * 로그 컨텍스트 타입
 */
export type LogContext = Record<string, unknown>;

/**
 * 로거 클래스
 *
 * @description
 * 구조화된 로깅을 제공하는 로거 클래스입니다.
 * 싱글톤 패턴으로 사용하거나 인스턴스를 직접 생성할 수 있습니다.
 */
export class Logger {
  private level: LogLevel;
  private timestamps: boolean;
  private json: boolean;
  private maskSensitive: boolean;

  constructor(config: LoggerConfig = {}) {
    this.level = config.level ?? parseLogLevel(process.env.LOG_LEVEL);
    this.timestamps = config.timestamps ?? true;
    this.json = config.json ?? (process.env.LOG_FORMAT === 'json');
    this.maskSensitive = config.maskSensitive ?? true;
  }

  /**
   * 로그 레벨 설정
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * 현재 로그 레벨 반환
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * 특정 레벨이 현재 설정에서 활성화되어 있는지 확인
   */
  isLevelEnabled(level: LogLevel): boolean {
    return level >= this.level;
  }

  /**
   * 타임스탬프 생성
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * 컨텍스트 객체 포맷팅
   */
  private formatContext(context?: LogContext): string {
    if (!context || Object.keys(context).length === 0) {
      return '';
    }

    const formatted = Object.entries(context)
      .map(([key, value]) => {
        let strValue: string;
        if (typeof value === 'object') {
          strValue = JSON.stringify(value);
        } else {
          strValue = String(value);
        }

        if (this.maskSensitive) {
          strValue = maskSensitiveInfo(strValue);
        }

        return `${key}=${strValue}`;
      })
      .join(' ');

    return ` | ${formatted}`;
  }

  /**
   * 에러 스택 포맷팅
   */
  private formatError(error?: Error): string {
    if (!error) return '';

    let errorStr = ` | error=${error.name}: ${error.message}`;
    if (this.level === LogLevel.DEBUG && error.stack) {
      errorStr += `\n${error.stack}`;
    }

    if (this.maskSensitive) {
      errorStr = maskSensitiveInfo(errorStr);
    }

    return errorStr;
  }

  /**
   * JSON 형식으로 로그 출력
   */
  private logJson(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: LogContext
  ): void {
    const logObject = {
      timestamp: this.getTimestamp(),
      level: LOG_LEVEL_NAMES[level],
      message: this.maskSensitive ? maskSensitiveInfo(message) : message,
      ...(error && {
        error: {
          name: error.name,
          message: this.maskSensitive
            ? maskSensitiveInfo(error.message)
            : error.message,
          ...(this.level === LogLevel.DEBUG && { stack: error.stack }),
        },
      }),
      ...context,
    };

    const output =
      level >= LogLevel.ERROR ? console.error : console.log;
    output(JSON.stringify(logObject));
  }

  /**
   * 텍스트 형식으로 로그 출력
   */
  private logText(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: LogContext
  ): void {
    const timestamp = this.timestamps
      ? chalk.dim(`[${this.getTimestamp()}] `)
      : '';

    let levelStr: string;
    switch (level) {
      case LogLevel.DEBUG:
        levelStr = chalk.gray('DEBUG');
        break;
      case LogLevel.INFO:
        levelStr = chalk.blue('INFO');
        break;
      case LogLevel.WARN:
        levelStr = chalk.yellow('WARN');
        break;
      case LogLevel.ERROR:
        levelStr = chalk.red('ERROR');
        break;
      default:
        levelStr = 'UNKNOWN';
    }

    const maskedMessage = this.maskSensitive
      ? maskSensitiveInfo(message)
      : message;
    const contextStr = this.formatContext(context);
    const errorStr = this.formatError(error);

    const fullMessage = `${timestamp}${levelStr} ${maskedMessage}${contextStr}${errorStr}`;

    const output =
      level >= LogLevel.ERROR ? console.error : console.log;
    output(fullMessage);
  }

  /**
   * 로그 출력 (내부)
   */
  private log(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: LogContext
  ): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    if (this.json) {
      this.logJson(level, message, error, context);
    } else {
      this.logText(level, message, error, context);
    }
  }

  /**
   * DEBUG 레벨 로그
   *
   * @param message - 로그 메시지
   * @param context - 추가 컨텍스트 정보
   */
  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, undefined, context);
  }

  /**
   * INFO 레벨 로그
   *
   * @param message - 로그 메시지
   * @param context - 추가 컨텍스트 정보
   */
  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, undefined, context);
  }

  /**
   * WARN 레벨 로그
   *
   * @param message - 로그 메시지
   * @param context - 추가 컨텍스트 정보
   */
  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, undefined, context);
  }

  /**
   * ERROR 레벨 로그
   *
   * @param message - 로그 메시지
   * @param error - 에러 객체 (선택)
   * @param context - 추가 컨텍스트 정보
   */
  error(message: string, error?: Error, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, error, context);
  }

  /**
   * 자식 로거 생성
   * 기본 컨텍스트가 항상 포함되는 로거를 생성합니다.
   *
   * @param baseContext - 기본 컨텍스트
   * @returns 자식 로거
   */
  child(baseContext: LogContext): ChildLogger {
    return new ChildLogger(this, baseContext);
  }
}

/**
 * 자식 로거 클래스
 *
 * @description
 * 기본 컨텍스트가 항상 포함되는 로거입니다.
 */
class ChildLogger {
  constructor(
    private parent: Logger,
    private baseContext: LogContext
  ) {}

  private mergeContext(context?: LogContext): LogContext {
    return { ...this.baseContext, ...context };
  }

  debug(message: string, context?: LogContext): void {
    this.parent.debug(message, this.mergeContext(context));
  }

  info(message: string, context?: LogContext): void {
    this.parent.info(message, this.mergeContext(context));
  }

  warn(message: string, context?: LogContext): void {
    this.parent.warn(message, this.mergeContext(context));
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.parent.error(message, error, this.mergeContext(context));
  }
}

/**
 * 기본 로거 인스턴스 (싱글톤)
 */
export const logger = new Logger();

/**
 * 새 로거 인스턴스 생성
 *
 * @param config - 로거 설정
 * @returns 새 로거 인스턴스
 */
export function createLogger(config?: LoggerConfig): Logger {
  return new Logger(config);
}
