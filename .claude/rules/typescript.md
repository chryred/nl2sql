---
description: TypeScript coding conventions
globs: ["**/*.ts"]
---

# TypeScript Style Guide

## Function Documentation
```typescript
/**
 * 함수 설명
 * @param param - 파라미터 설명
 * @returns 반환값 설명
 */
export function functionName(param: string): string {
  // ...
}
```

## Naming Conventions
```typescript
// 인터페이스: 명확한 이름
export interface ConfigFile {
  ai?: { ... };
  database?: { ... };
}

// 상수: 대문자 + 언더스코어
const DANGEROUS_KEYWORDS = ['DROP', 'DELETE'] as const;

// 타입: 별도 export
export type OutputFormat = 'table' | 'json' | 'csv';
```

## Import/Export Rules
```typescript
// ESM import (.js 확장자 필수)
import { getConfig } from './config/index.js';

// type import는 별도로
import type { Knex } from 'knex';
import type { Config } from './config/index.js';

// 명시적 export
export function publicFunction() { ... }
export { privateHelper as helper };
```

## Testing Conventions
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
