# Oracle UTL_RAW Execute-Aware Design

**Date:** 2026-03-03
**Status:** Approved

## Problem

`getDbSpecificNotes()` 함수는 `oracleDataCharset` 존재 시 항상 "ALWAYS wrap Korean VARCHAR2 columns with UTL_RAW.CAST_TO_RAW" 지시를 프롬프트에 포함합니다.
결과적으로 `execute=false`(드라이런) 상황에서도 UTL_RAW가 포함된 SQL이 반환되어 가독성이 떨어집니다.
또한, pre-supplied `sql` 파라미터를 실행할 때 UTL_RAW 변환이 적용되지 않아 한글 데이터가 깨질 수 있습니다.

## Requirements

| 조건 | 동작 |
|---|---|
| `execute=false` (드라이런) | UTL_RAW 없는 가독성 좋은 SQL 반환 |
| `execute=true` + `oracleDataCharset` 존재 | LLM이 SELECT·WHERE의 한글 컬럼 판단 후 UTL_RAW 적용 SQL로 실행 |
| `input.sql` (pre-supplied) + `execute=true` + `oracleDataCharset` | 동일한 LLM 후처리로 UTL_RAW 적용 후 실행 |
| `output.sql` 필드 | 항상 가독성 좋은 원본 SQL (UTL_RAW 버전 아님) |

## Approach: 통합 LLM 후처리 (Post-processing Pass)

NL→SQL 생성 프롬프트에서 UTL_RAW 지시를 제거하고, execute 시점에 별도 LLM 패스로 UTL_RAW 변환을 수행합니다.
NL→SQL 흐름과 pre-supplied SQL 흐름이 동일한 후처리 메서드를 공유합니다.

### 데이터 흐름

```
[드라이런 - execute=false]
NL → generateSQL(prompt: UTL_RAW 없음) → 가독성 SQL → output.sql 반환

[실행 - execute=true + oracleDataCharset]
NL → generateSQL → 가독성 SQL (원본)
    → wrapOracleKoreanColumns(sql) [LLM 후처리]
        - 스키마 + 원본 SQL을 LLM에 전달
        - SELECT/WHERE 한글 VARCHAR2 컬럼에 UTL_RAW.CAST_TO_RAW 적용
        - 변환된 SQL 반환
    → executeSQL(wrapped_sql)
    → output: { sql=원본_SQL, results=실행결과 }

[pre-supplied sql - execute=true + oracleDataCharset]
input.sql → wrapOracleKoreanColumns(input.sql) [동일 후처리]
    → executeSQL(wrapped_sql)
    → output: { sql=input.sql(원본), results=실행결과 }
```

## Components

### 1. `src/ai/prompt-builder.ts`

**제거:**
- `getDbSpecificNotes()` Oracle 케이스에서 `charsetNote` (UTL_RAW "ALWAYS wrap" 안내) 제거

**추가:**
- `buildOracleKoreanWrapPrompt(sql: string, schema: SchemaInfo, charset: string): string`
  - 원본 SQL + 스키마 (테이블명, 컬럼명, 타입, 코멘트) + charset 정보를 받아 프롬프트 생성
  - LLM 지시: "SELECT 컬럼과 WHERE 조건에서 한글 VARCHAR2 컬럼을 `UTL_RAW.CAST_TO_RAW(col) AS col` 형태로 변환. SQL만 반환."

### 2. `src/core/nl2sql-engine.ts`

**추가 메서드: `wrapOracleKoreanColumns(sql: string): Promise<string>`**
```typescript
async wrapOracleKoreanColumns(sql: string): Promise<string>
// 1. this.getSchema() 로 스키마 취득
// 2. buildOracleKoreanWrapPrompt(sql, schema, charset) 로 프롬프트 생성
// 3. this.aiClient.generateSQL(prompt) 호출
// 4. parseSQL(response) 로 SQL 파싱 후 반환
```

**수정: `process(naturalLanguageQuery, execute)`**
```typescript
// execute=true + oracleDataCharset 시:
// generateSQL() → (clean sql) → wrapOracleKoreanColumns(sql) → executeSQL(wrapped)
// output.sql은 항상 clean sql
```

### 3. `src/mcp/tools/nl2sql-query.ts`

**pre-supplied sql 경로 수정:**
```typescript
if (input.sql) {
  sql = input.sql;  // 원본 유지
  let sqlToExecute = sql;
  if (input.execute && config.database.oracleDataCharset) {
    sqlToExecute = await engine.wrapOracleKoreanColumns(sql);
  }
  if (input.execute) {
    executionResult = await engine.executeSQL(sqlToExecute);
  }
}
```

## AI Provider

`wrapOracleKoreanColumns()`는 기존 `AIProvider.generateSQL(prompt: string): Promise<string>` 메서드를 재사용합니다. 별도 메서드 추가 불필요.

## Edge Cases

| 케이스 | 처리 |
|---|---|
| Oracle 아닌 DB | `wrapOracleKoreanColumns` 호출 자체를 하지 않음 |
| `oracleDataCharset` 미설정 | 기존과 동일 (UTL_RAW 없음) |
| LLM이 SQL 변환 실패 시 | 원본 sql을 fallback으로 사용하거나 에러 propagation (TBD) |
| 한글 컬럼이 없는 SQL | LLM이 변환 없이 원본 반환 |

## Impact

- `getDbSpecificNotes()` 의 UTL_RAW 안내 제거: oracleDataCharset 설정 사용자의 기존 동작 변경
  - 이전: 모든 쿼리에 UTL_RAW 포함
  - 이후: execute=true 쿼리에만 UTL_RAW 포함 (더 올바른 동작)
- `generateSQL()` 시그니처 변경 없음 → CLI, 기존 테스트 영향 없음

## Files to Modify

1. `src/ai/prompt-builder.ts` - UTL_RAW 안내 제거 + `buildOracleKoreanWrapPrompt` 추가
2. `src/core/nl2sql-engine.ts` - `wrapOracleKoreanColumns` 추가 + `process()` 수정
3. `src/mcp/tools/nl2sql-query.ts` - pre-supplied sql 경로에 후처리 추가
