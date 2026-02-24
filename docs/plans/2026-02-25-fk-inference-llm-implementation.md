# FK 추론 LLM 기반 개선 구현 플랜

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `column_match` FK 추론을 LLM 기반(`generateInferFK`)으로 교체하고, MCP 응답 간소화 및 메타 정보 schema prefix 수정

**Architecture:** `InferenceOptions`에 `aiProvider`/`schemaTables`/`metadata`를 추가하여 `inferRelationships()`가 `column_match` 타입 요청 시 `inferByLLM()`을 호출한다. MCP tool 레이어에서 AI provider를 생성해 주입한다.

**Tech Stack:** TypeScript/ESM, Knex, Zod, Jest (ESM unstable_mockModule), @anthropic-ai/sdk, openai

---

## Task 1: `InferredRelationship` 인터페이스 확장 + YAML `inferenceUpsert` 동적 파라미터화

**Files:**
- Modify: `src/database/metadata/types.ts`
- Modify: `src/database/schemas/metadata/postgresql-metadata.yaml:393-404`
- Modify: `src/database/schemas/metadata/mysql-metadata.yaml:365-373`
- Modify: `src/database/schemas/metadata/oracle-metadata.yaml:365-392`
- Modify: `src/database/metadata/relationship-inference.ts` (`upsertRelationship` 함수)

### Step 1: `InferredRelationship`에 `relationshipType`, `joinHint` 추가

`src/database/metadata/types.ts` 의 `InferredRelationship` 인터페이스를 수정한다.

현재:
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
}
```

변경 후:
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
  // LLM 추론 시 추가 정보
  relationshipType?: RelationshipType;   // 없으면 upsert에서 'MANY_TO_ONE' 기본값
  joinHint?: JoinHint;                   // 없으면 upsert에서 'LEFT' 기본값
}
```

### Step 2: YAML `inferenceUpsert` SQL — relationship_type, join_hint 동적화

**PostgreSQL** (`postgresql-metadata.yaml:393-404`) — 12개 바인딩으로 변경:
```yaml
  inferenceUpsert:
    sql: |
      INSERT INTO table_relationships (
        source_schema, source_table, source_column,
        target_schema, target_table, target_column,
        relationship_type, confidence_level, join_hint,
        description, is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (source_schema, source_table, source_column,
                   target_schema, target_table, target_column)
      DO NOTHING
    mapping: {}
```

**MySQL** (`mysql-metadata.yaml:365-373`) — 12개 바인딩으로 변경:
```yaml
  inferenceUpsert:
    sql: |
      INSERT IGNORE INTO table_relationships (
        source_schema, source_table, source_column,
        target_schema, target_table, target_column,
        relationship_type, confidence_level, join_hint,
        description, is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    mapping: {}
```

**Oracle** (`oracle-metadata.yaml:365-392`) — MERGE USING에는 6개 파라미터,
INSERT VALUES에는 `relationship_type`, `join_hint` 추가(총 6개):
```yaml
  inferenceUpsert:
    sql: |
      MERGE INTO table_relationships tr
      USING (
        SELECT ? AS source_schema, ? AS source_table, ? AS source_column,
               ? AS target_schema, ? AS target_table, ? AS target_column
        FROM DUAL
      ) src
      ON (
        tr.source_schema = src.source_schema
        AND tr.source_table = src.source_table
        AND tr.source_column = src.source_column
        AND tr.target_schema = src.target_schema
        AND tr.target_table = src.target_table
        AND tr.target_column = src.target_column
      )
      WHEN NOT MATCHED THEN
        INSERT (
          source_schema, source_table, source_column,
          target_schema, target_table, target_column,
          relationship_type, confidence_level, join_hint,
          description, is_active, created_by
        ) VALUES (
          src.source_schema, src.source_table, src.source_column,
          src.target_schema, src.target_table, src.target_column,
          ?, ?, ?, {{DESCRIPTION_BIND}}, ?, ?
        )
    mapping: {}
```

### Step 3: `upsertRelationship()` 바인딩 업데이트

`src/database/metadata/relationship-inference.ts` 의 `upsertRelationship()` 함수에서 `bindings` 배열을 수정한다.

```typescript
const relationshipTypeVal = candidate.relationshipType ?? 'MANY_TO_ONE';
const joinHintVal = candidate.joinHint ?? 'LEFT';

const bindings = [
  candidate.sourceSchema,
  candidate.sourceTable,
  candidate.sourceColumn,
  candidate.targetSchema,
  candidate.targetTable,
  candidate.targetColumn,
  relationshipTypeVal,   // 신규 (index 7)
  candidate.confidenceLevel,
  joinHintVal,           // 신규 (index 9)
  descriptionVal,
  isActiveVal,
  createdBy,
];
```

> **주의**: Oracle MERGE는 USING SELECT에 6개(source/target), VALUES에 6개(type/level/hint/desc/active/by) 순서다.

### Step 4: 빌드 확인

```bash
npm run build
```
Expected: 에러 없음

### Step 5: 기존 YAML 로드 테스트 실행

```bash
npm test -- --testPathPattern="relationship-inference" --verbose
```
Expected: `inferenceUpsert` 관련 테스트 PASS

### Step 6: Commit

```bash
git add src/database/metadata/types.ts \
        src/database/schemas/metadata/postgresql-metadata.yaml \
        src/database/schemas/metadata/mysql-metadata.yaml \
        src/database/schemas/metadata/oracle-metadata.yaml \
        src/database/metadata/relationship-inference.ts
git commit -m "feat: add relationshipType/joinHint to InferredRelationship and dynamic YAML bindings"
```

---

## Task 2: `applyInferredRelationships()` — LLM 추론 결과 is_active/createdBy 처리

**Files:**
- Modify: `src/database/metadata/relationship-inference.ts` (`applyInferredRelationships` 함수)

### Step 1: `applyInferredRelationships()` 수정

현재 `isActive`/`createdBy` 결정 로직:
```typescript
const isActive = c.confidenceLevel === 'MEDIUM' ? true : false;
const createdBy = c.inferenceType === 'naming_convention'
  ? 'naming_convention'
  : 'column_match';
```

변경 후 (`column_match` 타입은 LLM 추론이므로 항상 is_active=true):
```typescript
let isActive: boolean;
let createdBy: string;
if (c.inferenceType === 'naming_convention') {
  isActive = c.confidenceLevel === 'MEDIUM';
  createdBy = 'naming_convention';
} else {
  // LLM 기반 추론 (column_match 타입)
  isActive = true;
  createdBy = 'llm_inference';
}
```

### Step 2: 빌드 확인

```bash
npm run build
```

### Step 3: Commit

```bash
git add src/database/metadata/relationship-inference.ts
git commit -m "feat: set is_active=true and createdBy='llm_inference' for LLM-inferred relationships"
```

---

## Task 3: AI 프로바이더 system prompt 교체 (Anthropic, OpenAI)

**Files:**
- Modify: `src/ai/providers/anthropic.ts` (`AnthropicProvider/generateInferFK`)
- Modify: `src/ai/providers/openai.ts` (`OpenAIProvider/generateInferFK`)

> DevX는 서버 사이드 에이전트(`nl2sql_infer_fk`) 사용이므로 변경 없음.

### Step 1: Anthropic system prompt 교체

`src/ai/providers/anthropic.ts` 의 `generateInferFK` 메서드 system prompt를 아래로 교체:

```typescript
system: `You are a senior DBA analyzing a database schema to infer implicit foreign key relationships that are not enforced as explicit FK constraints.

Your task:
1. Analyze table structures, column names, data types, comments, and business context
2. Identify columns that likely reference primary/unique keys in other tables
3. Consider naming patterns (e.g., {table_name}_id, {table_name}_cd, {table_name}_no)
4. Use column/table comments and glossary terms to understand Korean business semantics
5. Determine the most appropriate JOIN type (INNER: required relationship, LEFT: optional)
6. Skip any relationships already listed in "Existing Relationships"

Return ONLY a valid JSON array with NO explanation outside it.
Each object must have exactly these fields:
{
  "source_schema": "schema name",
  "source_table": "table with the FK column",
  "source_column": "FK column name",
  "target_schema": "schema name",
  "target_table": "referenced table (usually the one with PK)",
  "target_column": "referenced column (usually PK)",
  "relationship_type": "MANY_TO_ONE | ONE_TO_ONE | ONE_TO_MANY | MANY_TO_MANY",
  "confidence": "HIGH | MEDIUM | LOW",
  "join_hint": "INNER | LEFT | RIGHT | FULL",
  "description": "추론 근거를 한국어로 간결하게 작성 (예: '예약 → 매장 관계')"
}

If no new relationships are found, return [].`,
```

`max_tokens`는 `4096`으로 늘린다 (다수 관계 추론 시 응답 잘림 방지).

### Step 2: OpenAI system prompt 교체

`src/ai/providers/openai.ts` 의 `generateInferFK` 메서드 system content를 동일 프롬프트로 교체.
`max_tokens`도 `4096`으로 늘린다.

### Step 3: 빌드 확인

```bash
npm run build
```

### Step 4: Commit

```bash
git add src/ai/providers/anthropic.ts src/ai/providers/openai.ts
git commit -m "feat: update generateInferFK system prompt for DBA-perspective FK inference"
```

---

## Task 4: `inferByLLM()` — 실패 테스트 먼저 작성 (TDD)

**Files:**
- Test: `tests/unit/relationship-inference.test.ts`

### Step 1: 테스트 파일 상단 mock 추가

`tests/unit/relationship-inference.test.ts` 의 `beforeAll` 블록에 `inferByLLM` import 추가:

```typescript
let inferByLLM: any;
// beforeAll 안에:
inferByLLM = (inference as any).inferByLLM; // 아직 export 안 함 → 실패 예상
```

### Step 2: `inferByLLM` 실패 테스트 추가

파일 끝 `describe('relationship-inference'...)` 블록 안에 추가:

```typescript
describe('inferByLLM', () => {
  const mockAIProvider = {
    generateInferFK: jest.fn(),
    generateSQL: jest.fn(),
    generateComment: jest.fn(),
    selectTables: jest.fn(),
  };

  const mockSchemaTables = [
    {
      name: 'RESERVATIONS',
      schemaName: 'NL2SQL',
      comment: '예약 테이블',
      columns: [
        { name: 'RESERVATION_ID', type: 'NUMBER', isPrimaryKey: true, nullable: false },
        { name: 'STORE_ID', type: 'NUMBER', isPrimaryKey: false, nullable: false },
        { name: 'MEMBER_ID', type: 'NUMBER', isPrimaryKey: false, nullable: false },
      ],
      indexes: [],
    },
    {
      name: 'STORES',
      schemaName: 'NL2SQL',
      comment: '매장 테이블',
      columns: [
        { name: 'STORE_ID', type: 'NUMBER', isPrimaryKey: true, nullable: false },
        { name: 'STORE_NAME', type: 'VARCHAR2', isPrimaryKey: false, nullable: false },
      ],
      indexes: [],
    },
  ];

  const existingSet = new Set<string>();

  it('should call aiProvider.generateInferFK and return mapped InferredRelationship[]', async () => {
    mockAIProvider.generateInferFK.mockResolvedValueOnce(JSON.stringify([
      {
        source_schema: 'NL2SQL',
        source_table: 'RESERVATIONS',
        source_column: 'STORE_ID',
        target_schema: 'NL2SQL',
        target_table: 'STORES',
        target_column: 'STORE_ID',
        relationship_type: 'MANY_TO_ONE',
        confidence: 'HIGH',
        join_hint: 'INNER',
        description: '예약 → 매장 관계',
      },
    ]));

    const result = await inferByLLM(mockAIProvider, mockSchemaTables, undefined, existingSet);

    expect(result).toHaveLength(1);
    expect(result[0].sourceTable).toBe('RESERVATIONS');
    expect(result[0].targetTable).toBe('STORES');
    expect(result[0].confidenceLevel).toBe('HIGH');
    expect(result[0].relationshipType).toBe('MANY_TO_ONE');
    expect(result[0].joinHint).toBe('INNER');
    expect(result[0].description).toBe('예약 → 매장 관계');
    expect(result[0].inferenceType).toBe('column_match');
  });

  it('should skip relationships already in existingSet', async () => {
    const existingWithDup = new Set([
      'nl2sql.reservations.store_id→nl2sql.stores.store_id',
    ]);

    mockAIProvider.generateInferFK.mockResolvedValueOnce(JSON.stringify([
      {
        source_schema: 'NL2SQL',
        source_table: 'RESERVATIONS',
        source_column: 'STORE_ID',
        target_schema: 'NL2SQL',
        target_table: 'STORES',
        target_column: 'STORE_ID',
        relationship_type: 'MANY_TO_ONE',
        confidence: 'HIGH',
        join_hint: 'INNER',
        description: '예약 → 매장 관계',
      },
    ]));

    const result = await inferByLLM(mockAIProvider, mockSchemaTables, undefined, existingWithDup);
    expect(result).toHaveLength(0);
  });

  it('should return [] and log warn when LLM returns invalid JSON', async () => {
    mockAIProvider.generateInferFK.mockResolvedValueOnce('not json');
    const result = await inferByLLM(mockAIProvider, mockSchemaTables, undefined, existingSet);
    expect(result).toHaveLength(0);
  });

  it('should return [] gracefully when aiProvider is undefined', async () => {
    const result = await inferByLLM(undefined, mockSchemaTables, undefined, existingSet);
    expect(result).toHaveLength(0);
  });
});
```

### Step 3: 테스트 실행 → 실패 확인

```bash
npm test -- --testPathPattern="relationship-inference" --verbose
```
Expected: `inferByLLM is not a function` 또는 `undefined` 관련 FAIL

---

## Task 5: `inferByLLM()` 구현 + `InferenceOptions` 확장 + `inferRelationships()` 분기

**Files:**
- Modify: `src/database/metadata/relationship-inference.ts`

### Step 1: import 추가

파일 상단 import 블록에 추가:

```typescript
import type { AIProvider } from '../../ai/providers/openai.js';
import { formatSchemaForPrompt } from '../schema-extractor.js';
import type { ExtendedTableInfo } from '../schema-extractor.js';
import type { MetadataCache } from './types.js';
```

> `AIProvider`의 실제 import 경로는 `src/ai/providers/openai.ts`가 interface를 export하는 파일 확인 후 조정.
> 현재 `AIProvider` interface는 `src/ai/providers/openai.ts`에 있음.

### Step 2: `InferenceOptions` 확장

```typescript
export interface InferenceOptions {
  schema?: string;
  types?: ('naming_convention' | 'column_match')[];
  // LLM 기반 추론에 필요한 선택적 파라미터
  aiProvider?: AIProvider;
  schemaTables?: ExtendedTableInfo[];
  metadata?: MetadataCache;
}
```

### Step 3: `buildFKInferencePrompt()` 추가

`inferByColumnMatch` 함수 바로 위에 추가:

```typescript
/**
 * LLM FK 추론용 프롬프트를 생성합니다.
 */
function buildFKInferencePrompt(
  schemaTables: ExtendedTableInfo[],
  existingSet: Set<string>,
  namingConventions: NamingConvention[],
  metadata?: MetadataCache
): string {
  const sections: string[] = [];

  // 1. 스키마 정보
  sections.push(`=== Database Schema ===\n${formatSchemaForPrompt(schemaTables)}`);

  // 2. 기존 관계 (중복 방지)
  if (existingSet.size > 0) {
    const relLines = [...existingSet].map((r) => `  - ${r.replace('→', ' → ')}`);
    sections.push(`=== Existing Relationships (이미 등록됨, 중복 금지) ===\n${relLines.join('\n')}`);
  }

  // 3. 비즈니스 용어집
  if (metadata?.glossaryTerms && metadata.glossaryTerms.length > 0) {
    const glossLines = metadata.glossaryTerms.slice(0, 20).map((t) => {
      const def = t.definition ? ` - ${t.definition}` : '';
      return `  - "${t.term}" → ${t.sqlCondition}${def}`;
    });
    sections.push(`=== Business Glossary ===\n${glossLines.join('\n')}`);
  }

  // 4. 네이밍 컨벤션 (참고용)
  if (namingConventions.length > 0) {
    const ncLines = namingConventions.slice(0, 10).map(
      (nc) => `  - 컬럼 패턴 ${nc.columnPattern} → ${nc.targetTablePattern}.${nc.targetColumnPattern}`
    );
    sections.push(`=== Naming Conventions (참고용) ===\n${ncLines.join('\n')}`);
  }

  return sections.join('\n\n');
}
```

### Step 4: `inferByLLM()` 추가

`inferByColumnMatch` 함수 바로 뒤에 추가:

```typescript
/**
 * LLM 기반으로 FK 관계를 추론합니다.
 */
export async function inferByLLM(
  aiProvider: AIProvider | undefined,
  schemaTables: ExtendedTableInfo[],
  metadata: MetadataCache | undefined,
  existingSet: Set<string>,
  namingConventions: NamingConvention[] = []
): Promise<InferredRelationship[]> {
  if (!aiProvider) {
    logger.warn('inferByLLM: aiProvider not provided, skipping LLM inference');
    return [];
  }

  const prompt = buildFKInferencePrompt(schemaTables, existingSet, namingConventions, metadata);

  let rawResponse: string;
  try {
    rawResponse = await aiProvider.generateInferFK(prompt);
  } catch (err) {
    logger.warn(`inferByLLM: AI call failed — ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  // JSON 파싱
  let parsed: unknown[];
  try {
    // 마크다운 코드블록 제거 (```json ... ```)
    const cleaned = rawResponse.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned) as unknown[];
    if (!Array.isArray(parsed)) {
      logger.warn('inferByLLM: LLM response is not a JSON array');
      return [];
    }
  } catch {
    logger.warn(`inferByLLM: Failed to parse LLM response as JSON: ${rawResponse.slice(0, 200)}`);
    return [];
  }

  // 스키마 내 테이블/컬럼 존재 확인용 Set 구축
  const tableColSet = new Set<string>();
  for (const t of schemaTables) {
    for (const c of t.columns) {
      tableColSet.add(
        `${(t.schemaName ?? '').toLowerCase()}.${t.name.toLowerCase()}.${c.name.toLowerCase()}`
      );
    }
  }

  const candidates: InferredRelationship[] = [];
  const seen = new Set<string>();

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;

    const sourceSchema = String(r['source_schema'] ?? '');
    const sourceTable  = String(r['source_table']  ?? '');
    const sourceColumn = String(r['source_column'] ?? '');
    const targetSchema = String(r['target_schema'] ?? '');
    const targetTable  = String(r['target_table']  ?? '');
    const targetColumn = String(r['target_column'] ?? '');

    if (!sourceTable || !sourceColumn || !targetTable || !targetColumn) {
      logger.warn(`inferByLLM: skipping incomplete item: ${JSON.stringify(r)}`);
      continue;
    }

    // 존재하지 않는 컬럼이면 skip
    const srcKey = `${sourceSchema.toLowerCase()}.${sourceTable.toLowerCase()}.${sourceColumn.toLowerCase()}`;
    const tgtKey = `${targetSchema.toLowerCase()}.${targetTable.toLowerCase()}.${targetColumn.toLowerCase()}`;
    if (!tableColSet.has(srcKey)) {
      logger.warn(`inferByLLM: source column not found: ${srcKey}`);
      continue;
    }
    if (!tableColSet.has(tgtKey)) {
      logger.warn(`inferByLLM: target column not found: ${tgtKey}`);
      continue;
    }

    // 중복 확인
    const relKey = `${srcKey}→${tgtKey}`;
    if (existingSet.has(relKey) || seen.has(relKey)) continue;
    seen.add(relKey);

    const confidenceRaw = String(r['confidence'] ?? 'LOW').toUpperCase();
    const confidenceLevel: ConfidenceLevel =
      confidenceRaw === 'HIGH' ? 'HIGH' :
      confidenceRaw === 'MEDIUM' ? 'MEDIUM' : 'LOW';

    const relType = String(r['relationship_type'] ?? 'MANY_TO_ONE') as RelationshipType;
    const joinH   = String(r['join_hint'] ?? 'LEFT') as JoinHint;

    candidates.push({
      sourceSchema,
      sourceTable,
      sourceColumn,
      targetSchema,
      targetTable,
      targetColumn,
      confidenceLevel,
      inferenceType: 'column_match',
      description: String(r['description'] ?? `LLM 추론: ${sourceTable}.${sourceColumn} → ${targetTable}.${targetColumn}`),
      relationshipType: relType,
      joinHint: joinH,
    });
  }

  logger.info(`inferByLLM: ${candidates.length} candidates inferred`);
  return candidates;
}
```

### Step 5: `inferRelationships()` 분기 수정

`inferRelationships()` 함수의 `column_match` 블록 교체:

```typescript
// 2) LLM 기반 추론 (column_match 타입)
if (types.includes('column_match')) {
  const { aiProvider, schemaTables, metadata } = options ?? {};
  const cmCandidates = await inferByLLM(
    aiProvider,
    schemaTables ?? [],
    metadata,
    existingSet,
    namingConventions
  );
  logger.info(`LLM inference: ${cmCandidates.length} candidates`);
  allCandidates.push(...cmCandidates);
}
```

### Step 6: 테스트 실행 → 통과 확인

```bash
npm test -- --testPathPattern="relationship-inference" --verbose
```
Expected: 새로 추가한 `inferByLLM` 테스트 모두 PASS

### Step 7: 빌드

```bash
npm run build
```

### Step 8: Commit

```bash
git add src/database/metadata/relationship-inference.ts \
        tests/unit/relationship-inference.test.ts
git commit -m "feat: implement inferByLLM replacing column_match heuristic"
```

---

## Task 6: `inferRelationshipsTool()` — AI provider 주입 + 응답 간소화

**Files:**
- Modify: `src/mcp/tools/infer-relationships.ts`

### Step 1: import 추가

파일 상단에 추가:

```typescript
import { buildConfigFromEntry } from '../utils/config-helper.js';
import { createAIClient } from '../../ai/client-factory.js';
import { extractSchema } from '../../database/schema-extractor.js';
```

### Step 2: `inferRelationshipsTool()` 수정

`inferRelationships()` 호출 부분과 응답 부분을 아래와 같이 수정:

```typescript
export async function inferRelationshipsTool(
  input: InferRelationshipsInput,
  connManager: ConnectionManager
): Promise<InferRelationshipsOutput> {
  const entry = connManager.resolve(input.connectionId);
  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
    };
  }

  try {
    // 메타데이터 캐시 + AI provider + 스키마 준비
    const config = buildConfigFromEntry(entry);
    const [cache, schemaTables] = await Promise.all([
      connManager.getOrInitCache(entry.connectionId),
      connManager.getOrInitSchemaCache(entry.connectionId, config).then((sc) => sc?.tables ?? []),
    ]);

    const namingConventions    = cache?.namingConventions    ?? [];
    const existingRelationships = cache?.relationships       ?? [];
    const metadata              = cache ?? undefined;

    // AI provider (column_match 타입에 필요)
    let aiProvider;
    try {
      aiProvider = createAIClient(config);
    } catch {
      aiProvider = undefined; // AI 설정 없으면 LLM 추론 skip
    }

    // 추론 실행
    const candidates = await inferRelationships(
      entry.knex,
      entry.params.type,
      namingConventions,
      existingRelationships,
      {
        schema: input.schema,
        types: input.types,
        aiProvider,
        schemaTables,
        metadata,
      }
    );

    // 타입별 카운트
    const ncCount  = candidates.filter((c) => c.inferenceType === 'naming_convention').length;
    const llmCount = candidates.filter((c) => c.inferenceType === 'column_match').length;

    if (input.mode === 'preview') {
      return {
        success: true,
        message: `Found ${candidates.length} candidates (naming_convention: ${ncCount}, llm: ${llmCount})`,
        connectionId: entry.connectionId,
      };
    }

    // apply 모드
    if (candidates.length === 0) {
      return {
        success: true,
        message: 'No new relationships to apply',
        connectionId: entry.connectionId,
      };
    }

    const { applied, skipped } = await applyInferredRelationships(
      entry.knex,
      entry.params.type,
      candidates,
      entry.params.oracleDataCharset
    );

    if (applied > 0) {
      connManager.invalidateCache(entry.connectionId);
    }

    return {
      success: true,
      message: `Applied ${applied}, skipped ${skipped}`,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to infer relationships',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}
```

### Step 3: `InferRelationshipsOutput` 에서 `result` 필드 제거

```typescript
export interface InferRelationshipsOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  error?: string;
  // result 필드 제거 (응답 간소화)
}
```

### Step 4: `formatInferenceResult()` 함수가 있다면 제거

파일 상단 `formatInferenceResult` 함수가 있으면 삭제.

### Step 5: 빌드

```bash
npm run build
```

### Step 6: Commit

```bash
git add src/mcp/tools/infer-relationships.ts
git commit -m "feat: inject AI provider into inferRelationships and simplify MCP response to counts only"
```

---

## Task 7: `formatMetadataForPrompt()` — table_relationships에 schema prefix 추가

**Files:**
- Modify: `src/ai/prompt-builder.ts`

### Step 1: relationships 라인 수정

`formatMetadataForPrompt()` 함수 내 `Table Relationships` 블록 수정:

현재:
```typescript
const relationshipLines = metadata.relationships.map((rel) => {
  const joinType = rel.joinHint
    ? ` (${rel.joinHint} JOIN recommended)`
    : '';
  return `  - ${rel.sourceTable}.${rel.sourceColumn} -> ${rel.targetTable}.${rel.targetColumn} (${rel.relationshipType})${joinType}`;
});
```

변경 후:
```typescript
const relationshipLines = metadata.relationships.map((rel) => {
  const joinType = rel.joinHint
    ? ` (${rel.joinHint} JOIN recommended)`
    : '';
  const srcPrefix = rel.sourceSchema ? `${rel.sourceSchema}.` : '';
  const tgtPrefix = rel.targetSchema ? `${rel.targetSchema}.` : '';
  return `  - ${srcPrefix}${rel.sourceTable}.${rel.sourceColumn} -> ${tgtPrefix}${rel.targetTable}.${rel.targetColumn} (${rel.relationshipType})${joinType}`;
});
```

### Step 2: 빌드 + 전체 테스트

```bash
npm run build && npm test
```
Expected: 모든 테스트 PASS

### Step 3: Commit

```bash
git add src/ai/prompt-builder.ts
git commit -m "fix: include schema prefix in table_relationships when passed to LLM prompt"
```

---

## Task 8: 최종 검증

### Step 1: 전체 빌드 + 린트

```bash
npm run build && npm run lint
```

### Step 2: 전체 테스트

```bash
npm test
```
Expected: 모든 테스트 PASS

### Step 3: README / MCP 문서 업데이트

`README.md` 와 `.claude/rules/mcp.md` 의 `infer_relationships` 설명 수정:

```markdown
| `infer_relationships` | FK 관계 추론 (naming_convention: 패턴 기반 MEDIUM신뢰도, column_match: LLM 기반 추론) |
```

버전 히스토리에 추가:
```markdown
### v1.10.0
- `infer_relationships`: `column_match` 타입을 LLM 기반 추론으로 교체 (DBA 관점 프롬프트)
- 스키마 + 메타데이터(용어집, 네이밍 컨벤션) 전달로 정확도 향상
- LLM 추론 결과에 `relationship_type`, `join_hint`, 한글 `description` 포함
- MCP 응답 간소화: preview/apply 모두 카운트만 반환
- `formatMetadataForPrompt()` table_relationships에 schema prefix 추가
```

### Step 4: Final commit

```bash
git add README.md .claude/rules/mcp.md
git commit -m "docs: update mcp.md and README for FK inference LLM improvement (v1.10.0)"
```
