# Design: wrapOracleKoreanColumns 스키마 필터링 최적화

**Date:** 2026-03-03
**Status:** Approved

## Problem

`wrapOracleKoreanColumns`가 전체 스키마를 LLM에 전달하여 불필요한 토큰 소비가 발생한다.
SQL 쿼리가 실제로 참조하는 테이블만 스키마에 포함하면 토큰을 대폭 절감할 수 있다.

## Solution

SQL에서 참조 테이블명을 regex로 추출한 뒤, 기존 `filterSchemaByTables`로 스키마를 필터링하고
줄어든 스키마를 `buildOracleKoreanWrapPrompt`에 전달한다.

## Architecture

```
wrapOracleKoreanColumns(sql)
  │
  ├─ extractTablesFromSQL(sql)          ← NEW (src/utils/sql-parser.ts)
  │   FROM/JOIN/UPDATE/INTO 뒤 테이블명 추출
  │   → ['orders', 'customers']
  │
  ├─ filterSchemaByTables(schema, tableNames)   ← 기존 재사용
  │   → 필터된 SchemaInfo
  │
  └─ buildOracleKoreanWrapPrompt(sql, filteredSchema, charset)
      → LLM 호출 (줄어든 토큰)
```

## New File: `src/utils/sql-parser.ts`

```typescript
export function extractTablesFromSQL(sql: string): string[]
```

**파싱 대상:** `FROM`, `JOIN`(모든 유형), `UPDATE`, `INTO` 키워드 뒤 테이블명
**정규화:** 별칭(alias) 제거, `schema.table` → `table`
**CTE:** `WITH xxx AS` 구문의 CTE 이름은 실제 테이블이 아니므로 결과에서 제외
**Fallback:** 추출 결과가 비어있으면 전체 스키마 사용

## Changes

### `src/core/nl2sql-engine.ts`

`wrapOracleKoreanColumns` 메서드에 다음 추가:

```typescript
const tableNames = extractTablesFromSQL(sql);
const filteredSchema = tableNames.length > 0
  ? filterSchemaByTables(schema, tableNames)
  : schema;
// buildOracleKoreanWrapPrompt에 filteredSchema 전달
```

### `src/utils/sql-parser.ts` (신규)

`extractTablesFromSQL(sql: string): string[]` 구현

## Tests

- `tests/unit/sql-parser.test.ts` (신규): 단순 SELECT, JOIN, 서브쿼리, CTE, schema prefix, 빈 결과 케이스
- `tests/unit/nl2sql-engine-wrap-oracle.test.ts` (수정): 다중 테이블 스키마에서 관련 테이블만 프롬프트에 포함되는지 검증
