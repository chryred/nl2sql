# FK 추론 LLM 기반 개선 설계

- **날짜**: 2026-02-25
- **작성자**: Brainstorming session
- **상태**: 승인됨

## 배경

현재 `infer_relationships` MCP 도구는 두 가지 추론 방식을 지원한다:
1. `naming_convention`: 네이밍 컨벤션 패턴 기반 (MEDIUM 신뢰도) — 유지
2. `column_match`: 동일 컬럼명 기반 휴리스틱 (LOW 신뢰도) — **LLM 기반으로 교체**

## 목표

1. `column_match` 추론을 LLM(`generateInferFK`) 기반으로 교체하여 정확도 향상
2. LLM에 테이블 스키마 + 메타 정보를 전달해 DBA 관점의 FK 추론 수행
3. LLM 응답을 `table_relationships` 포맷에 맞게 저장 (Oracle 한글 charset 포함)
4. MCP 응답 간소화: preview/apply 모두 카운트만 반환 (토큰 소모 축소)
5. `formatMetadataForPrompt()`의 `table_relationships` 라인에 schema prefix 추가

## 접근 방식: Approach A — AIProvider 주입

`InferenceOptions`에 `aiProvider`, `schemaTables`, `metadata`를 추가하여
`inferRelationships()` 함수가 `column_match` 타입 처리 시 LLM을 호출한다.

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/database/metadata/types.ts` | `InferredRelationship`에 `relationshipType`, `joinHint` 추가 |
| `src/database/metadata/relationship-inference.ts` | `InferenceOptions` 확장, `inferByColumnMatch()` → `inferByLLM()` 교체, `upsertRelationship()` 바인딩 확장 |
| `src/ai/providers/anthropic.ts` | `generateInferFK()` system prompt DBA 관점으로 교체 |
| `src/ai/providers/openai.ts` | `generateInferFK()` system prompt DBA 관점으로 교체 |
| `src/mcp/tools/infer-relationships.ts` | AI provider 주입, 응답 간소화 |
| `src/ai/prompt-builder.ts` | `formatMetadataForPrompt()` relationships에 schema prefix 추가 |
| `src/database/schemas/metadata/*.yaml` | `inferenceUpsert` SQL에 `relationship_type`, `join_hint` 컬럼 추가 |

## 데이터 흐름

```
inferRelationshipsTool()
  ├─ buildConfigFromEntry(entry) → createAIClient(config) → aiProvider
  ├─ getOrInitSchemaCache() → schemaTables (ExtendedTableInfo[])
  ├─ getOrInitCache() → namingConventions, existingRelationships, metadata
  └─ inferRelationships(knex, dbType, namingConventions, existingRels, {
        types, schema,
        aiProvider,        ← NEW
        schemaTables,      ← NEW
        metadata           ← NEW
      })
        ├─ [naming_convention] inferByNamingConvention() → 기존 유지
        └─ [column_match] inferByLLM()
              ├─ buildFKInferencePrompt(schemaTables, metadata, existingSet)
              ├─ aiProvider.generateInferFK(prompt)
              ├─ JSON 파싱 → InferredRelationship[]
              └─ source/target schema 없으면 현재 schema 폴백

applyInferredRelationships() → upsertRelationship()
  └─ Oracle charset 처리 기존 유지 (encodeForOracle + UTL_RAW)
```

## 인터페이스 변경

### `InferredRelationship` (types.ts)

```typescript
export interface InferredRelationship {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  confidenceLevel: ConfidenceLevel;
  inferenceType: 'naming_convention' | 'column_match';
  matchedPattern?: string;
  description: string;
  // 신규 추가
  relationshipType?: RelationshipType;
  joinHint?: JoinHint;
}
```

### `InferenceOptions` (relationship-inference.ts)

```typescript
export interface InferenceOptions {
  schema?: string;
  types?: ('naming_convention' | 'column_match')[];
  // 신규 추가
  aiProvider?: AIProvider;
  schemaTables?: ExtendedTableInfo[];
  metadata?: MetadataCache;
}
```

## LLM 프롬프트 설계

### System Prompt

```
You are a senior DBA analyzing a database schema to infer implicit foreign key relationships
that are not enforced as explicit FK constraints.

Your task:
1. Analyze table structures, column names, data types, comments, and business context
2. Identify columns that likely reference primary/unique keys in other tables
3. Consider naming patterns (e.g., {table_name}_id, {table_name}_cd, {table_name}_no)
4. Use column/table comments and glossary terms to understand Korean business semantics
5. Determine the most appropriate JOIN type (INNER: required, LEFT: optional)
6. Skip any relationships already listed in "Existing Relationships"

Return ONLY a valid JSON array with NO explanation outside it.
Each object must have exactly these fields:
{
  "source_schema": "스키마명",
  "source_table": "FK 컬럼을 가진 테이블",
  "source_column": "FK 역할을 하는 컬럼",
  "target_schema": "스키마명",
  "target_table": "참조되는 테이블",
  "target_column": "참조되는 컬럼 (보통 PK)",
  "relationship_type": "MANY_TO_ONE | ONE_TO_ONE | ONE_TO_MANY | MANY_TO_MANY",
  "confidence": "HIGH | MEDIUM | LOW",
  "join_hint": "INNER | LEFT | RIGHT | FULL",
  "description": "추론 근거를 한국어로 간결하게 작성 (예: '예약 → 매장 관계')"
}

If no new relationships are found, return [].
```

### User Prompt 구조 (`buildFKInferencePrompt`)

```
=== Database Schema ===
{formatSchemaForPrompt(schemaTables)}

=== Existing Relationships (이미 등록됨, 중복 금지) ===
- NL2SQL.RESERVATIONS.STORE_ID → NL2SQL.STORES.STORE_ID
...

=== Business Glossary ===
- "VIP 고객" → member_grade = 'VIP'
...

=== Naming Conventions (참고용) ===
- 컬럼 패턴 ^store_id$ → stores.store_id
...
```

## LLM 응답 → DB 저장 매핑

| LLM 응답 필드 | DB 컬럼 | 비고 |
|---|---|---|
| `source_schema` | `source_schema` | 없으면 현재 schema 폴백 |
| `source_table` | `source_table` | |
| `source_column` | `source_column` | |
| `target_schema` | `target_schema` | 없으면 현재 schema 폴백 |
| `target_table` | `target_table` | |
| `target_column` | `target_column` | |
| `relationship_type` | `relationship_type` | |
| `confidence` | `confidence_level` | HIGH/MEDIUM/LOW |
| `join_hint` | `join_hint` | INNER/LEFT/RIGHT/FULL |
| `description` | `description` | 한글 (Oracle charset 처리) |
| *(고정)* | `is_active` | **1** (기본 적용) |
| *(고정)* | `created_by` | `'llm_inference'` |

## MCP 응답 간소화

```json
// preview 모드
{
  "success": true,
  "message": "Found 5 candidates (naming_convention: 3, llm: 2)",
  "connectionId": "..."
}

// apply 모드
{
  "success": true,
  "message": "Applied 4, skipped 1 (naming_convention: applied 3 / llm: applied 1, skipped 1)",
  "connectionId": "..."
}
```

## 에러 처리

| 상황 | 처리 방법 |
|---|---|
| `aiProvider` 없이 `column_match` 요청 | warn 로그 후 빈 배열 반환 (graceful degradation) |
| LLM 응답 JSON 파싱 실패 | warn 로그 + 빈 배열, 전체 중단 없음 |
| LLM이 존재하지 않는 테이블/컬럼 반환 | 해당 항목만 skip (warn 로그) |
| Oracle charset 한글 description | 기존 `encodeForOracle()` + `UTL_RAW` 처리 그대로 적용 |
| 네트워크/AI API 오류 | catch → warn 로그, 빈 배열 반환 |
