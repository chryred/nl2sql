---
name: quick-test
description: Run quick unit tests for a specific module
user-invocable: true
args: module_name
---

# Quick Test

특정 모듈의 단위 테스트를 빠르게 실행합니다.

## Instructions

### 1. 전체 테스트
```bash
npm test
```

### 2. 특정 모듈 테스트

사용자가 지정한 모듈명으로 테스트를 실행하세요:

```bash
npm test -- --testPathPattern="<module_name>"
```

예시:
- `npm test -- --testPathPattern="sql-validator"` - SQL 검증 테스트
- `npm test -- --testPathPattern="errors"` - 에러 클래스 테스트
- `npm test -- --testPathPattern="config"` - 설정 로더 테스트

### 3. Watch 모드

개발 중 지속적 테스트:
```bash
npm test -- --watch --testPathPattern="<module_name>"
```

## Available Test Files

```
tests/unit/
├── config.test.ts
├── errors.test.ts
├── sql-validator.test.ts
├── input-validator.test.ts
└── ...
```
