---
description: Security and error handling rules
globs: ["**/validation/**", "**/sql*.ts", "**/errors/**", "**/core/**"]
---

# Security Guidelines

## SQL Validation
```typescript
// validateSQL() 필수 사용
const validation = validateSQL(sql);
if (!validation.valid) {
  throw new SQLValidationError(validation.error);
}
```

## Blocked SQL Patterns
- **항상 차단**: DROP, DELETE, TRUNCATE, ALTER
- **인젝션 감지**: UNION SELECT, SQL 주석, 파일 접근

## Input Validation
```typescript
// validateNaturalLanguageInput() 사용
const result = validateNaturalLanguageInput(userInput);
if (!result.valid) {
  throw new InputValidationError(result.error);
}
```

## API Key Validation
```typescript
if (!validateApiKeyFormat('openai', apiKey)) {
  throw new ConfigurationError('Invalid API key format');
}
```

# Error Handling

## Custom Error Classes
```typescript
import { NL2SQLError, SQLValidationError } from './errors';

// 에러는 code + userMessage 포함
throw new SQLValidationError('Detailed message', sql, 'reason');
```

## Production Error Handling
```typescript
// Production에서는 userMessage만 노출
const message = isProduction ? error.toUserMessage() : error.message;

// 민감 정보 마스킹
import { maskSensitiveInfo } from './errors';
console.error(maskSensitiveInfo(error.message));
```
