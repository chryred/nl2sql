/**
 * 애플리케이션 설정 관리 모듈
 *
 * @description
 * 환경 변수와 설정 파일에서 설정을 로드하고 검증합니다.
 * Zod 스키마를 사용하여 타입 안전성을 보장합니다.
 * AI 제공자(OpenAI, Anthropic)와 데이터베이스 연결 설정을 관리합니다.
 *
 * 설정 우선순위: CLI 옵션 > 환경변수 > 설정파일 > 기본값
 *
 * @module config
 *
 * @example
 * import { getConfig, validateConfig } from './config';
 *
 * const config = getConfig();
 * validateConfig(config);
 *
 * console.log(`Using ${config.ai.provider} as AI provider`);
 * console.log(`Connecting to ${config.database.type} database`);
 */

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

// 환경 변수 로드
dotenvConfig();

/**
 * 설정 파일 스키마
 *
 * @description
 * nl2sql.config.json 또는 nl2sql.config.yaml 파일의 구조를 정의합니다.
 */
interface ConfigFile {
  ai?: {
    provider?: 'openai' | 'anthropic';
    model?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
  };
  database?: {
    type?: 'postgresql' | 'mysql' | 'oracle';
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    serviceName?: string;
  };
  logging?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
  };
}

/**
 * API 키 형식 검증 패턴
 */
const API_KEY_PATTERNS = {
  openai: /^sk-[a-zA-Z0-9]{20,}$/,
  anthropic: /^sk-ant-[a-zA-Z0-9-]{20,}$/,
} as const;

/**
 * API 키 형식을 검증합니다.
 *
 * @param provider - AI 제공자 (openai 또는 anthropic)
 * @param key - 검증할 API 키
 * @returns 유효한 형식이면 true
 *
 * @example
 * validateApiKeyFormat('openai', 'sk-abc123...'); // true 또는 false
 */
export function validateApiKeyFormat(
  provider: 'openai' | 'anthropic',
  key: string
): boolean {
  const pattern = API_KEY_PATTERNS[provider];
  if (!pattern) return false;
  return pattern.test(key);
}

/**
 * 설정 파일을 로드합니다.
 *
 * @description
 * 현재 디렉토리에서 nl2sql.config.json 또는 nl2sql.config.yaml 파일을 찾아 로드합니다.
 * JSON 파일이 우선됩니다.
 *
 * @returns 설정 파일 내용 또는 빈 객체
 */
function loadConfigFile(): ConfigFile {
  const cwd = process.cwd();
  const jsonPath = join(cwd, 'nl2sql.config.json');
  const yamlPath = join(cwd, 'nl2sql.config.yaml');
  const ymlPath = join(cwd, 'nl2sql.config.yml');

  try {
    // JSON 파일 우선
    if (existsSync(jsonPath)) {
      const content = readFileSync(jsonPath, 'utf-8');
      return JSON.parse(content) as ConfigFile;
    }

    // YAML 파일 (.yaml 또는 .yml)
    const yamlFilePath = [yamlPath, ymlPath].find((p) => existsSync(p));
    if (yamlFilePath) {
      const content = readFileSync(yamlFilePath, 'utf-8');
      return yaml.load(content) as ConfigFile;
    }
  } catch {
    // 설정 파일 로드 실패 시 무시
  }

  return {};
}

/**
 * 설정 스키마 정의
 *
 * @description
 * Zod를 사용하여 설정 객체의 구조와 유효성을 정의합니다.
 * 기본값과 선택적 필드를 포함합니다.
 */
const configSchema = z.object({
  /** AI 제공자 설정 */
  ai: z.object({
    /** AI 제공자 (openai 또는 anthropic) */
    provider: z.enum(['openai', 'anthropic']).default('openai'),
    /** OpenAI API 키 (OpenAI 사용 시 필수) */
    openaiApiKey: z.string().optional(),
    /** Anthropic API 키 (Anthropic 사용 시 필수) */
    anthropicApiKey: z.string().optional(),
    /** 사용할 AI 모델 (선택적, 기본값은 제공자별 기본 모델) */
    model: z.string().optional(),
  }),
  /** 데이터베이스 연결 설정 */
  database: z.object({
    /** 데이터베이스 타입 */
    type: z.enum(['postgresql', 'mysql', 'oracle']),
    /** 호스트 주소 */
    host: z.string().default('localhost'),
    /** 포트 번호 */
    port: z.number().int().positive(),
    /** 사용자명 */
    user: z.string(),
    /** 비밀번호 */
    password: z.string(),
    /** 데이터베이스명 */
    database: z.string(),
    /** Oracle 서비스 이름 (Oracle 사용 시 선택적) */
    serviceName: z.string().optional(),
  }),
});

/**
 * 설정 타입
 *
 * @description
 * Zod 스키마에서 추론된 설정 타입입니다.
 * AI 제공자 설정과 데이터베이스 연결 설정을 포함합니다.
 */
export type Config = z.infer<typeof configSchema>;

/**
 * 환경 변수와 설정 파일에서 설정을 로드합니다.
 *
 * @description
 * 설정 파일과 환경 변수를 읽어 설정 객체를 생성합니다.
 * 우선순위: 환경변수 > 설정파일 > 기본값
 *
 * 데이터베이스 타입에 따라 기본 포트를 설정합니다:
 * - PostgreSQL: 5432
 * - MySQL: 3306
 * - Oracle: 1521
 *
 * @returns 파싱된 설정 객체
 * @throws 설정 검증 실패 시 ZodError
 * @private
 */
function loadConfig(): Config {
  // 설정 파일 로드
  const configFile = loadConfigFile();

  // 데이터베이스 타입 결정 (환경변수 > 설정파일 > 기본값)
  const dbType = (process.env.DB_TYPE ||
    configFile.database?.type ||
    'postgresql') as 'postgresql' | 'mysql' | 'oracle';
  const defaultPort =
    dbType === 'mysql' ? 3306 : dbType === 'oracle' ? 1521 : 5432;

  // 환경변수와 설정파일 병합 (환경변수 우선)
  const rawConfig = {
    ai: {
      provider:
        process.env.NL2SQL_AI_PROVIDER || configFile.ai?.provider || 'openai',
      openaiApiKey: process.env.OPENAI_API_KEY || configFile.ai?.openaiApiKey,
      anthropicApiKey:
        process.env.ANTHROPIC_API_KEY || configFile.ai?.anthropicApiKey,
      model: process.env.NL2SQL_MODEL || configFile.ai?.model,
    },
    database: {
      type: dbType,
      host: process.env.DB_HOST || configFile.database?.host || 'localhost',
      port:
        parseInt(process.env.DB_PORT || '', 10) ||
        configFile.database?.port ||
        defaultPort,
      user: process.env.DB_USER || configFile.database?.user || '',
      password: process.env.DB_PASSWORD || configFile.database?.password || '',
      database: process.env.DB_NAME || configFile.database?.database || '',
      serviceName:
        process.env.DB_SERVICE_NAME || configFile.database?.serviceName,
    },
  };

  return configSchema.parse(rawConfig);
}

/**
 * 애플리케이션 설정을 가져옵니다.
 *
 * @description
 * 환경 변수에서 설정을 로드하고 Zod 스키마로 검증합니다.
 * 매 호출 시 새로운 설정 객체를 생성합니다.
 *
 * @returns 검증된 설정 객체
 * @throws 설정이 유효하지 않으면 ZodError
 *
 * @example
 * const config = getConfig();
 * console.log(`Database: ${config.database.type}`);
 * console.log(`AI Provider: ${config.ai.provider}`);
 */
export function getConfig(): Config {
  return loadConfig();
}

/**
 * 설정의 필수 값들을 검증합니다.
 *
 * @description
 * Zod 스키마 검증 외에 추가적인 비즈니스 로직 검증을 수행합니다:
 * - OpenAI 사용 시 OPENAI_API_KEY 필수 및 형식 검증
 * - Anthropic 사용 시 ANTHROPIC_API_KEY 필수 및 형식 검증
 * - DB_USER 필수
 * - DB_NAME 필수
 *
 * @param config - 검증할 설정 객체
 * @throws 필수 값이 없거나 형식이 잘못되면 Error
 *
 * @example
 * const config = getConfig();
 * try {
 *   validateConfig(config);
 *   console.log('Configuration is valid');
 * } catch (error) {
 *   console.error('Invalid configuration:', error.message);
 * }
 */
export function validateConfig(config: Config): void {
  // OpenAI API 키 검증
  if (config.ai.provider === 'openai') {
    if (!config.ai.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required when using OpenAI provider');
    }
    if (!validateApiKeyFormat('openai', config.ai.openaiApiKey)) {
      throw new Error(
        'OPENAI_API_KEY format is invalid. Expected format: sk-...'
      );
    }
  }

  // Anthropic API 키 검증
  if (config.ai.provider === 'anthropic') {
    if (!config.ai.anthropicApiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required when using Anthropic provider'
      );
    }
    if (!validateApiKeyFormat('anthropic', config.ai.anthropicApiKey)) {
      throw new Error(
        'ANTHROPIC_API_KEY format is invalid. Expected format: sk-ant-...'
      );
    }
  }

  // 데이터베이스 필수 값 검증
  if (!config.database.user) {
    throw new Error('DB_USER is required');
  }
  if (!config.database.database) {
    throw new Error('DB_NAME is required');
  }
}
