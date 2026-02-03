# NL2SQL Project - Coding Conventions & Guidelines

이 파일은 Claude Code가 프로젝트 컨텍스트를 기억하기 위한 메모리 파일입니다.

## Project Overview

- **프로젝트명**: NL2SQL CLI Tool
- **언어**: TypeScript 5.x (ESM)
- **목적**: 자연어를 SQL로 변환하는 CLI 도구

## Coding Conventions

### TypeScript Style

```typescript
// 1. 함수는 JSDoc 주석 사용
/**
 * 함수 설명
 * @param param - 파라미터 설명
 * @returns 반환값 설명
 */
export function functionName(param: string): string {
  // ...
}

// 2. 인터페이스는 명확한 이름 사용
export interface ConfigFile {
  ai?: { ... };
  database?: { ... };
}

// 3. 상수는 대문자 + 언더스코어
const DANGEROUS_KEYWORDS = ['DROP', 'DELETE'] as const;

// 4. 타입 정의는 별도 export
export type OutputFormat = 'table' | 'json' | 'csv';
```

### File Structure Conventions

```
src/
├── index.ts              # CLI 진입점 (Commander.js)
├── cli/commands/         # CLI 명령어 핸들러
├── cli/formatters/       # 출력 포맷터
├── config/               # 설정 로더 (Zod 스키마)
├── core/                 # 핵심 비즈니스 로직
├── ai/                   # AI 프로바이더 통합
│   └── providers/        # OpenAI, Anthropic 구현체
├── database/             # DB 연결 및 스키마 추출
│   └── adapters/         # PostgreSQL, MySQL, Oracle 어댑터
├── errors/               # 커스텀 에러 클래스
├── logger/               # 로깅 시스템
└── utils/                # 유틸리티 함수
```

### Error Handling

```typescript
// 1. 커스텀 에러 클래스 사용
import { NL2SQLError, SQLValidationError } from './errors';

// 2. 에러는 code + userMessage 포함
throw new SQLValidationError('Detailed message', sql, 'reason');

// 3. Production에서는 userMessage만 노출
const message = isProduction ? error.toUserMessage() : error.message;

// 4. 민감 정보는 항상 마스킹
import { maskSensitiveInfo } from './errors';
console.error(maskSensitiveInfo(error.message));
```

### Security Guidelines

```typescript
// 1. SQL 검증 필수 - validateSQL() 사용
const validation = validateSQL(sql);
if (!validation.valid) {
  throw new SQLValidationError(validation.error);
}

// 2. 위험 SQL 차단 목록
// - DROP, DELETE, TRUNCATE, ALTER: 항상 차단
// - UNION SELECT, SQL 주석, 파일 접근: 인젝션으로 간주

// 3. 입력 검증 필수 - validateNaturalLanguageInput() 사용
const result = validateNaturalLanguageInput(userInput);
if (!result.valid) {
  throw new InputValidationError(result.error);
}

// 4. API 키 형식 검증
if (!validateApiKeyFormat('openai', apiKey)) {
  throw new ConfigurationError('Invalid API key format');
}
```

### Import/Export Style

```typescript
// 1. ESM import 사용 (.js 확장자 필수)
import { getConfig } from './config/index.js';

// 2. type import는 별도로
import type { Knex } from 'knex';
import type { Config } from './config/index.js';

// 3. 명시적 export
export function publicFunction() { ... }
export { privateHelper as helper };
```

### Testing Conventions

```typescript
// tests/unit/*.test.ts 형식
describe('moduleName', () => {
  describe('functionName', () => {
    it('should do something', () => {
      expect(result).toBe(expected);
    });
  });
});
```

## Important Notes

### 주의사항

1. **ESM 모듈**: `import` 시 `.js` 확장자 필수
2. **Zod 검증**: 설정은 반드시 Zod 스키마로 검증
3. **에러 마스킹**: Production에서 민감 정보 노출 금지
4. **SQL 보안**: DROP, DELETE 등 위험 쿼리 자동 차단
5. **입력 검증**: 프롬프트 인젝션 패턴 감지 필수

### 빌드 & 테스트

```bash
npm run build    # TypeScript 컴파일
npm run lint     # ESLint 검사
npm test         # Jest 테스트 (109개 테스트)
```

### 설정 우선순위

CLI 옵션 > 환경변수 > 설정파일(json/yaml) > 기본값

### 의존성 관리

- **Production**: chalk, commander, dotenv, inquirer, knex, openai, @anthropic-ai/sdk, zod, js-yaml, ora
- **Development**: eslint, prettier, jest, ts-jest, typescript, tsx

## Version History

- **v1.0.0**: 초기 릴리스
  - SQL 검증 강화 (위험 패턴 감지)
  - 입력 검증 (프롬프트 인젝션 방지)
  - 커스텀 에러 클래스 체계
  - 로깅 시스템
  - 설정 파일 지원 (json/yaml)
  - 출력 포맷 옵션 (table/json/csv)
  - ESLint/Prettier 설정
  - Jest 테스트 프레임워크
