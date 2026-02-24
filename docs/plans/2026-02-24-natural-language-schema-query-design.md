# Design: Natural Language Schema Query

**Date:** 2026-02-24
**Status:** Approved

## Overview

`nl2sql_schema` MCP 도구가 현재 정확한 테이블명 배열만 받는 구조를 개선하여,
자연어 설명(예: "vip그룹고객조회")으로 연관 테이블을 LLM이 추정해 스키마를 반환하도록 한다.

## Problem

```
현재: nl2sql_schema({ tables: ["vip_grp_cust_inf", "vip_grp_inf"] })
목표: nl2sql_schema({ query: "vip그룹고객조회" })  → LLM이 관련 테이블 추정 후 스키마 반환
```

`tables`를 알아야만 스키마를 조회할 수 있어, 테이블명을 모르는 사용자에게 불편하다.

## Decision

**A안 채택**: `tables`를 optional로 변경하고, `query`(자연어) 파라미터를 신규 추가.
- `tables` 있음 → 기존 동작 유지
- `query`만 있음 → `NL2SQLEngine.getSchemaByQuery()` 호출

## Architecture

### Changed Files

| 파일 | 변경 내용 |
|------|-----------|
| `src/core/nl2sql-engine.ts` | `getSchemaByQuery()` 신규 메서드 추가 |
| `src/mcp/tools/nl2sql-schema.ts` | 입력 스키마 변경 + 핸들러 분기 추가 |

### Data Flow

```
MCP nl2sql_schema 호출
  ├─ tables 제공 → filterSchemaByTables (기존 동작)
  └─ query만 제공 → NL2SQLEngine.getSchemaByQuery(query)
                      ├─ getSchema()       전체 스키마 로드
                      ├─ getMetadata()     메타데이터 로드
                      ├─ buildTableSelectionPrompt() + aiClient.selectTables()
                      ├─ parseSelectedTables()
                      └─ filterSchemaByTables(선별 테이블) 반환
                           └─ fallback: 선별 결과 없으면 전체 스키마
```

## Component Design

### 1. `NL2SQLEngine.getSchemaByQuery()`

```typescript
async getSchemaByQuery(naturalLanguageQuery: string): Promise<SchemaInfo> {
  const schema = await this.getSchema();
  const metadata = await this.getMetadata();

  const tableSummary = formatSchemaSummary(schema);
  const selectionPrompt = buildTableSelectionPrompt(
    tableSummary,
    metadata?.glossaryTerms ?? [],
    metadata?.glossaryAliases ?? [],
    metadata?.relationships ?? [],
    metadata?.queryPatterns ?? [],
    metadata?.patternKeywords ?? [],
    naturalLanguageQuery
  );

  const selectionResponse = await this.aiClient.selectTables(selectionPrompt);
  const selectedTables = parseSelectedTables(selectionResponse);

  return selectedTables.length > 0
    ? filterSchemaByTables(schema, selectedTables)
    : schema;
}
```

**`generateSQL`과의 차이점:**
- `TABLE_COUNT_THRESHOLD` 체크 없음 — 항상 LLM 호출
- SQL 생성 없음 — 스키마 반환만

### 2. MCP 입력 스키마 변경

```typescript
nl2sqlSchemaInputSchema = z.object({
  tables: z.array(z.string()).optional()
    .describe('Table names (optional if query is provided)'),
  query: z.string().optional()
    .describe('Natural language description to infer related tables'),
  format: z.enum(['json', 'prompt', 'summary']).default('json'),
  connectionId: z.string().optional(),
}).refine(
  (data) => data.tables?.length || data.query,
  { message: 'Either tables or query must be provided' }
);
```

### 3. `nl2sqlSchema` / `nl2sqlSchemaLegacy` 분기

두 함수 모두 동일 패턴 적용:

```typescript
if (input.tables?.length) {
  // 기존: filterSchemaByTables
} else {
  // 신규: NL2SQLEngine.getSchemaByQuery(input.query!)
  // nl2sql-query.ts와 동일한 engine 생성 패턴 사용
  const engine = new NL2SQLEngine(knex, config, { metadataCache, schemaCache });
  const schema = await engine.getSchemaByQuery(input.query!);
}
```

## Error Handling

- LLM 선별 결과가 빈 배열 → 전체 스키마 fallback (기존 `generateSQL`과 동일 전략)
- `tables`도 `query`도 없음 → Zod `.refine()` validation error

## Testing

- `getSchemaByQuery()` 단위 테스트: 선별 결과 있음 / 없음(fallback) 두 케이스
- MCP 입력 스키마 검증 테스트: `tables`만 / `query`만 / 둘 다 없음 케이스
