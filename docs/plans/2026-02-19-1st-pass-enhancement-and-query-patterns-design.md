# Design: 1st Pass Enhancement & Query Patterns MCP Tools

**Date**: 2026-02-19
**Status**: Approved

## Overview

두 가지 기능을 구현한다:

1. **1st Pass 프롬프트 강화**: 테이블 선별 정확도 향상을 위해 TABLE_RELATIONSHIPS, queryPatterns 힌트, patternKeywords 추가
2. **Query Patterns MCP 도구 추가**: `query_pattern_add` (등록), `query_pattern_search` (검색) 2종

---

## Feature 1: 1st Pass Prompt Enhancement

### Problem

현재 `buildTableSelectionPrompt`는 tableSummary + glossaryTerms + glossaryAliases만 포함.
JOIN이 필요한 쿼리에서 관계 테이블을 누락하는 경우가 발생.

### Solution

`buildTableSelectionPrompt` 파라미터에 3가지 메타정보 추가:

| 추가 정보 | 이유 |
|-----------|------|
| `relationships: TableRelationship[]` | JOIN 대상 테이블 명시적 식별 |
| `queryPatterns: QueryPattern[]` | 패턴별 applicableTables로 관련 테이블 힌트 제공 |
| `patternKeywords: PatternKeyword[]` | 사용자 키워드 → 패턴 → 테이블 연결 |

### Signature Change

```typescript
// Before
export function buildTableSelectionPrompt(
  tableSummary: string,
  glossaryTerms: GlossaryTerm[],
  glossaryAliases: GlossaryAlias[],
  naturalLanguageQuery: string
): string

// After
export function buildTableSelectionPrompt(
  tableSummary: string,
  glossaryTerms: GlossaryTerm[],
  glossaryAliases: GlossaryAlias[],
  relationships: TableRelationship[],
  queryPatterns: QueryPattern[],
  patternKeywords: PatternKeyword[],
  naturalLanguageQuery: string
): string
```

### Prompt Sections Added

**TABLE_RELATIONSHIPS** (compact format):
```
Table Relationships (use these for JOIN decisions):
  - orders.customer_id → customers.id (MANY_TO_ONE)
  - order_items.order_id → orders.id (MANY_TO_ONE)
```

**Query Pattern Hints** (applicableTables만, SQL 템플릿 제외):
```
Query Pattern Table Hints:
  - "monthly_sales_agg" → related tables: [orders, order_items]
```

**Pattern Keywords**:
```
Pattern Keywords → Table Hints:
  - Keywords [월별, monthly] → "monthly_sales_agg" pattern → tables: [orders, order_items]
```

### Files Changed

- `src/ai/prompt-builder.ts`: `buildTableSelectionPrompt` 시그니처 및 본문 수정
- `src/core/nl2sql-engine.ts`: 호출부에 `metadata?.relationships`, `metadata?.queryPatterns`, `metadata?.patternKeywords` 전달
- `tests/unit/prompt-builder.test.ts`: 테스트 업데이트

---

## Feature 2: Query Patterns MCP Tools

### MCP Tool Order (Updated)

| 단계 | 도구명 | 파일 | 변경 |
|------|--------|------|------|
| 1 | db_test_connection | db-test.ts | - |
| 2 | db_connect | db-connect.ts | - |
| 3 | db_list_connections | db-list.ts | - |
| 4 | schema_setup | schema-setup.ts | - |
| 5 | cache_status | cache-manage.ts | - |
| 6 | cache_refresh | cache-manage.ts | - |
| 7 | infer_relationships | infer-relationships.ts | - |
| **8** | **query_pattern_add** | **query-pattern-manage.ts** | 신규 |
| **9** | **query_pattern_search** | **query-pattern-manage.ts** | 신규 |
| 10 | nl2sql_schema | nl2sql-schema.ts | 단계 번호만 변경 |
| 11 | nl2sql_query | nl2sql-query.ts | 단계 번호만 변경 |
| 12 | db_disconnect | db-disconnect.ts | 단계 번호만 변경 |

### `query_pattern_add` Schema

```typescript
inputSchema: {
  connectionId?: string,
  patternName: string,         // required
  category: PatternCategory,   // aggregate|join|filter|subquery|date_range|ranking|other
  sqlTemplate: string,         // required: 기본 SQL 템플릿
  sqlTemplatePg?: string,
  sqlTemplateMysql?: string,
  sqlTemplateOracle?: string,
  description?: string,
  exampleInput?: string,
  applicableTables?: string[],
  keywords?: string[]          // query_pattern_keywords에 함께 저장
}
```

**동작:**
1. `patternCode` = snake_case(patternName) + 4자리 랜덤 hex (중복 방지)
2. `nl2sql.query_patterns` INSERT
3. `keywords` 있으면 `nl2sql.query_pattern_keywords` INSERT (패턴당 다수)
4. 해당 connectionId의 캐시 즉시 갱신

### `query_pattern_search` Schema

```typescript
inputSchema: {
  connectionId?: string,
  keyword: string,   // required: patternName 또는 description ILIKE 검색
  limit?: number     // default: 10
}
```

**동작:**
1. DB에서 `patternName ILIKE %keyword%` OR `description ILIKE %keyword%` 검색
2. 각 패턴의 keywords 목록도 함께 반환
3. priority 내림차순 정렬

**반환값:**
```typescript
{
  success: boolean,
  patterns: Array<{
    patternCode: string,
    patternName: string,
    category: string,
    sqlTemplate: string,
    description?: string,
    exampleInput?: string,
    applicableTables?: string[],
    keywords: string[]
  }>
}
```

### New File: `src/mcp/tools/query-pattern-manage.ts`

기존 `cache-manage.ts`, `infer-relationships.ts` 패턴과 동일하게:
- 입출력 interface, Zod schema, 구현 함수를 같은 파일에 정의
- `connectionId` 지원 (ConnectionManager resolve)
- DBMS별 SQL은 `src/database/schemas/` YAML로 분리

### SQL YAML Files (New)

- `src/database/schemas/metadata/postgresql/query_pattern_add.yaml`
- `src/database/schemas/metadata/postgresql/query_pattern_search.yaml`
- `src/database/schemas/metadata/mysql/query_pattern_add.yaml`
- `src/database/schemas/metadata/mysql/query_pattern_search.yaml`
- `src/database/schemas/metadata/oracle/query_pattern_add.yaml`
- `src/database/schemas/metadata/oracle/query_pattern_search.yaml`

### `server.ts` Changes

- `createMcpServer` 버전 `1.2.0` → `1.5.0`
- 8단계(`query_pattern_add`), 9단계(`query_pattern_search`) 추가
- 기존 8~10단계 주석 번호를 10~12단계로 수정

---

## Testing

- `tests/unit/prompt-builder.test.ts` 업데이트: relationships/queryPatterns/patternKeywords 파라미터 추가
- `tests/unit/query-pattern-manage.test.ts` 신규 작성 (add, search 유닛 테스트)

## Docs Updates

- `README.md`: query_pattern_add, query_pattern_search 도구 추가
- `.claude/rules/mcp.md`: v1.5.0 변경 이력 추가
