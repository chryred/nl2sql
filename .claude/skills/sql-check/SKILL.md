---
name: sql-check
description: Validate SQL query for security issues
user-invocable: true
args: sql_query
---

# SQL Security Check

SQL 쿼리의 보안 문제를 검사합니다.

## Instructions

사용자가 제공한 SQL 쿼리를 분석하여 다음을 확인하세요:

### 1. 위험한 키워드 검사
- DROP, DELETE, TRUNCATE, ALTER → 차단
- INSERT, UPDATE → 경고

### 2. SQL 인젝션 패턴 검사
- UNION SELECT
- SQL 주석 (--,  /* */)
- 파일 접근 함수 (LOAD_FILE, INTO OUTFILE)
- 시스템 함수 (xp_cmdshell, exec)

### 3. 검사 수행

`src/core/sql-validator.ts`의 `validateSQL()` 함수를 참조하여 분석 결과를 제공하세요.

## Output Format

```
✅ 안전한 쿼리입니다.
```

또는

```
❌ 위험한 쿼리입니다.
- 위험 패턴: [발견된 패턴]
- 권장 조치: [수정 방법]
```
