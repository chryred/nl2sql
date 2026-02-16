# Two-Pass Table Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 600+ 테이블 환경에서 LLM 프롬프트 토큰을 ~100K → ~18K로 82% 절감

**Architecture:** `generateSQL()`에서 1st Pass로 테이블명+코멘트+용어집만 보내 관련 테이블을 선별하고, 2nd Pass에서 선별된 테이블의 상세 스키마+메타데이터로 SQL 생성. 테이블 30개 이하일 때는 기존 single-pass 유지.

**Tech Stack:** TypeScript, ESM, Jest, Zod

---

### Task 1: `formatSchemaSummary()` — 스키마 요약 포맷터

**Files:**
- Modify: `src/database/schema-extractor.ts`
- Test: `tests/unit/schema-extractor.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/schema-extractor.test.ts`:

```typescript
import { formatSchemaSummary } from '../../src/database/schema-extractor.js';
import type { SchemaInfo } from '../../src/database/types.js';

describe('formatSchemaSummary', () => {
  it('should format table names with comments', () => {
    const schema: SchemaInfo = {
      tables: [
        {
          name: 'customers',
          schemaName: 'public',
          comment: '고객 마스터',
          columns: [],
          constraints: [],
          indexes: [],
        },
        {
          name: 'orders',
          schemaName: 'public',
          comment: '주문',
          columns: [],
          constraints: [],
          indexes: [],
        },
      ],
    };
    const result = formatSchemaSummary(schema);
    expect(result).toContain('customers -- 고객 마스터');
    expect(result).toContain('orders -- 주문');
    expect(result).not.toContain('columns');
  });

  it('should handle tables without comments', () => {
    const schema: SchemaInfo = {
      tables: [
        {
          name: 'logs',
          columns: [],
          constraints: [],
          indexes: [],
        },
      ],
    };
    const result = formatSchemaSummary(schema);
    expect(result).toContain('logs');
    expect(result).not.toContain('--');
  });

  it('should include schema prefix when present', () => {
    const schema: SchemaInfo = {
      tables: [
        {
          name: 'users',
          schemaName: 'hr',
          comment: '사용자',
          columns: [],
          constraints: [],
          indexes: [],
        },
      ],
    };
    const result = formatSchemaSummary(schema);
    expect(result).toContain('hr.users -- 사용자');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern schema-extractor`
Expected: FAIL — `formatSchemaSummary` is not exported

**Step 3: Write minimal implementation**

Add to `src/database/schema-extractor.ts`:

```typescript
/**
 * 테이블명 + 코멘트만 요약 (1st Pass용)
 * @param schema - 전체 스키마 정보
 * @returns 테이블 요약 문자열
 */
export function formatSchemaSummary(schema: SchemaInfo): string {
  const lines: string[] = [];
  for (const table of schema.tables) {
    const prefix = table.schemaName ? `${table.schemaName}.` : '';
    const comment = table.comment ? ` -- ${table.comment}` : '';
    lines.push(`${prefix}${table.name}${comment}`);
  }
  return lines.join('\n');
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern schema-extractor`
Expected: PASS

**Step 5: Commit**

```bash
git add src/database/schema-extractor.ts tests/unit/schema-extractor.test.ts
git commit -m "feat: add formatSchemaSummary for 1st pass table selection"
```

---

### Task 2: `buildTableSelectionPrompt()` — 1st Pass 프롬프트

**Files:**
- Modify: `src/ai/prompt-builder.ts`
- Test: `tests/unit/prompt-builder.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/prompt-builder.test.ts`:

```typescript
import { buildTableSelectionPrompt } from '../../src/ai/prompt-builder.js';
import type { GlossaryTerm, GlossaryAlias } from '../../src/database/metadata/types.js';

describe('buildTableSelectionPrompt', () => {
  const tableSummary = 'public.customers -- 고객 마스터\npublic.orders -- 주문\npublic.products -- 상품';

  const glossaryTerms: GlossaryTerm[] = [
    {
      termCode: 'VIP',
      term: 'VIP고객',
      category: 'business_term',
      sqlCondition: "grade = 'VIP'",
      applyToTables: ['customers'],
      priority: 1,
    },
  ];

  const glossaryAliases: GlossaryAlias[] = [
    { termCode: 'VIP', alias: '우수고객' },
  ];

  it('should include table summary in prompt', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('customers -- 고객 마스터');
    expect(result).toContain('orders -- 주문');
  });

  it('should include glossary terms', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('VIP고객');
    expect(result).toContain("grade = 'VIP'");
  });

  it('should include glossary aliases', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('우수고객');
  });

  it('should include user query', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toContain('VIP고객정보를 조회해줘');
  });

  it('should request JSON array output', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, glossaryTerms, glossaryAliases, 'VIP고객정보를 조회해줘'
    );
    expect(result).toMatch(/JSON/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern prompt-builder`
Expected: FAIL — `buildTableSelectionPrompt` is not exported

**Step 3: Write minimal implementation**

Add to `src/ai/prompt-builder.ts`:

```typescript
/**
 * 1st Pass: 테이블 선별용 프롬프트 생성
 * @param tableSummary - 테이블명+코멘트 요약 문자열
 * @param glossaryTerms - 용어집
 * @param glossaryAliases - 용어 별칭
 * @param naturalLanguageQuery - 사용자 질문
 * @returns 테이블 선별 프롬프트
 */
export function buildTableSelectionPrompt(
  tableSummary: string,
  glossaryTerms: GlossaryTerm[],
  glossaryAliases: GlossaryAlias[],
  naturalLanguageQuery: string
): string {
  const sections: string[] = [];

  sections.push(`You are a database expert. Given the following list of available tables, select ONLY the tables needed to answer the user's question.`);

  sections.push(`Available Tables:\n${tableSummary}`);

  // 용어집
  if (glossaryTerms.length > 0) {
    const termLines = glossaryTerms.map((t) => {
      const aliases = glossaryAliases
        .filter((a) => a.termCode === t.termCode)
        .map((a) => a.alias);
      const aliasPart = aliases.length > 0 ? ` (also: ${aliases.join(', ')})` : '';
      const tableHint = t.applyToTables?.length ? ` [tables: ${t.applyToTables.join(', ')}]` : '';
      return `  - "${t.term}"${aliasPart} → ${t.sqlCondition}${tableHint}`;
    });
    sections.push(`Business Terms:\n${termLines.join('\n')}`);
  }

  sections.push(`User question: ${naturalLanguageQuery}`);

  sections.push(
    `Return ONLY a JSON array of table names (without schema prefix) that are needed to answer the question. Include tables needed for JOINs. Example: ["customers", "orders"]`
  );

  return sections.join('\n\n');
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern prompt-builder`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ai/prompt-builder.ts tests/unit/prompt-builder.test.ts
git commit -m "feat: add buildTableSelectionPrompt for 1st pass"
```

---

### Task 3: `parseSelectedTables()` — LLM 응답 파싱

**Files:**
- Modify: `src/ai/prompt-builder.ts`
- Modify: `tests/unit/prompt-builder.test.ts`

**Step 1: Write the failing test**

Append to `tests/unit/prompt-builder.test.ts`:

```typescript
import { parseSelectedTables } from '../../src/ai/prompt-builder.js';

describe('parseSelectedTables', () => {
  it('should parse clean JSON array', () => {
    const result = parseSelectedTables('["customers", "orders"]');
    expect(result).toEqual(['customers', 'orders']);
  });

  it('should parse JSON wrapped in markdown code block', () => {
    const result = parseSelectedTables('```json\n["customers", "orders"]\n```');
    expect(result).toEqual(['customers', 'orders']);
  });

  it('should handle extra whitespace', () => {
    const result = parseSelectedTables('  ["customers",  "orders"]  ');
    expect(result).toEqual(['customers', 'orders']);
  });

  it('should return empty array for invalid JSON', () => {
    const result = parseSelectedTables('not valid json');
    expect(result).toEqual([]);
  });

  it('should handle LLM response with explanation text around JSON', () => {
    const response = 'Based on the query, the relevant tables are:\n["customers", "vip_benefits"]\nThese tables contain...';
    const result = parseSelectedTables(response);
    expect(result).toEqual(['customers', 'vip_benefits']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern prompt-builder`
Expected: FAIL — `parseSelectedTables` is not exported

**Step 3: Write minimal implementation**

Add to `src/ai/prompt-builder.ts`:

```typescript
/**
 * 1st Pass LLM 응답에서 테이블명 배열 파싱
 * @param response - LLM 응답 문자열
 * @returns 테이블명 배열
 */
export function parseSelectedTables(response: string): string[] {
  let text = response.trim();

  // Remove markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // Try to extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern prompt-builder`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ai/prompt-builder.ts tests/unit/prompt-builder.test.ts
git commit -m "feat: add parseSelectedTables for 1st pass response parsing"
```

---

### Task 4: `filterSchemaByTables()` / `filterMetadataByTables()` — 필터링

**Files:**
- Modify: `src/core/nl2sql-engine.ts`
- Test: `tests/unit/nl2sql-engine.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/nl2sql-engine.test.ts`:

```typescript
import { filterSchemaByTables, filterMetadataByTables } from '../../src/core/nl2sql-engine.js';
import type { SchemaInfo } from '../../src/database/types.js';
import type { MetadataCache } from '../../src/database/metadata/types.js';

describe('filterSchemaByTables', () => {
  const schema: SchemaInfo = {
    tables: [
      { name: 'customers', columns: [], constraints: [], indexes: [] },
      { name: 'orders', columns: [], constraints: [], indexes: [] },
      { name: 'products', columns: [], constraints: [], indexes: [] },
    ],
  };

  it('should filter to only selected tables', () => {
    const result = filterSchemaByTables(schema, ['customers', 'orders']);
    expect(result.tables).toHaveLength(2);
    expect(result.tables.map((t) => t.name)).toEqual(['customers', 'orders']);
  });

  it('should return empty tables for no matches', () => {
    const result = filterSchemaByTables(schema, ['nonexistent']);
    expect(result.tables).toHaveLength(0);
  });

  it('should be case-insensitive', () => {
    const result = filterSchemaByTables(schema, ['CUSTOMERS']);
    expect(result.tables).toHaveLength(1);
  });
});

describe('filterMetadataByTables', () => {
  const metadata: MetadataCache = {
    relationships: [
      {
        sourceTable: 'orders',
        sourceColumn: 'customer_id',
        targetTable: 'customers',
        targetColumn: 'id',
        relationshipType: 'MANY_TO_ONE',
        confidence: 'HIGH',
      },
      {
        sourceTable: 'products',
        sourceColumn: 'category_id',
        targetTable: 'categories',
        targetColumn: 'id',
        relationshipType: 'MANY_TO_ONE',
        confidence: 'HIGH',
      },
    ],
    glossaryTerms: [
      {
        termCode: 'VIP',
        term: 'VIP고객',
        category: 'business_term',
        sqlCondition: "grade = 'VIP'",
        applyToTables: ['customers'],
        priority: 1,
      },
      {
        termCode: 'STOCK',
        term: '재고',
        category: 'business_term',
        sqlCondition: "stock > 0",
        applyToTables: ['products'],
        priority: 1,
      },
    ],
    queryPatterns: [
      {
        patternCode: 'P1',
        patternName: '고객 조회',
        category: 'lookup',
        sqlTemplate: 'SELECT * FROM customers',
        applicableTables: ['customers'],
        matchScoreThreshold: 0.5,
        priority: 1,
      },
    ],
    namingConventions: [],
    codeTables: [],
    columnCodeMappings: [],
    codeAliases: [],
    glossaryAliases: [],
    glossaryContexts: [],
    patternParameters: [],
    patternKeywords: [],
    loadedAt: new Date(),
    databaseType: 'postgresql',
  };

  it('should filter relationships to selected tables', () => {
    const result = filterMetadataByTables(metadata, ['customers', 'orders']);
    expect(result!.relationships).toHaveLength(1);
    expect(result!.relationships[0].sourceTable).toBe('orders');
  });

  it('should filter glossary terms to selected tables', () => {
    const result = filterMetadataByTables(metadata, ['customers']);
    expect(result!.glossaryTerms).toHaveLength(1);
    expect(result!.glossaryTerms[0].termCode).toBe('VIP');
  });

  it('should filter query patterns to selected tables', () => {
    const result = filterMetadataByTables(metadata, ['customers']);
    expect(result!.queryPatterns).toHaveLength(1);
  });

  it('should return null for null metadata', () => {
    const result = filterMetadataByTables(null, ['customers']);
    expect(result).toBeNull();
  });

  it('should keep glossary terms without applyToTables (global terms)', () => {
    const metadataWithGlobal: MetadataCache = {
      ...metadata,
      glossaryTerms: [
        {
          termCode: 'TODAY',
          term: '오늘',
          category: 'date_term',
          sqlCondition: "CURRENT_DATE",
          priority: 1,
        },
      ],
    };
    const result = filterMetadataByTables(metadataWithGlobal, ['customers']);
    expect(result!.glossaryTerms).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern nl2sql-engine`
Expected: FAIL — `filterSchemaByTables` is not exported

**Step 3: Write minimal implementation**

Add to `src/core/nl2sql-engine.ts` (as exported standalone functions, outside the class):

```typescript
/**
 * 선별된 테이블만 스키마에서 필터링
 * @param schema - 전체 스키마
 * @param tableNames - 선별된 테이블명 배열
 * @returns 필터링된 스키마
 */
export function filterSchemaByTables(
  schema: SchemaInfo,
  tableNames: string[]
): SchemaInfo {
  const nameSet = new Set(tableNames.map((n) => n.toLowerCase()));
  return {
    tables: schema.tables.filter((t) => nameSet.has(t.name.toLowerCase())),
    recentQueries: schema.recentQueries,
  };
}

/**
 * 선별된 테이블 관련 메타데이터만 필터링
 * @param metadata - 전체 메타데이터 캐시
 * @param tableNames - 선별된 테이블명 배열
 * @returns 필터링된 메타데이터
 */
export function filterMetadataByTables(
  metadata: MetadataCache | null,
  tableNames: string[]
): MetadataCache | null {
  if (!metadata) return null;

  const nameSet = new Set(tableNames.map((n) => n.toLowerCase()));
  const isRelevantTable = (t: string) => nameSet.has(t.toLowerCase());

  return {
    ...metadata,
    relationships: metadata.relationships.filter(
      (r) => isRelevantTable(r.sourceTable) || isRelevantTable(r.targetTable)
    ),
    glossaryTerms: metadata.glossaryTerms.filter(
      (t) => !t.applyToTables?.length || t.applyToTables.some(isRelevantTable)
    ),
    queryPatterns: metadata.queryPatterns.filter(
      (p) => !p.applicableTables?.length || p.applicableTables.some(isRelevantTable)
    ),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern nl2sql-engine`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/nl2sql-engine.ts tests/unit/nl2sql-engine.test.ts
git commit -m "feat: add filterSchemaByTables and filterMetadataByTables"
```

---

### Task 5: `generateSQL()` 2-Pass 통합

**Files:**
- Modify: `src/core/nl2sql-engine.ts` (method `NL2SQLEngine.generateSQL`)

**Step 1: Verify existing tests still pass**

Run: `npm test`
Expected: All existing tests PASS

**Step 2: Update `generateSQL()` method**

Replace the `generateSQL` method body in `src/core/nl2sql-engine.ts`:

```typescript
const TABLE_COUNT_THRESHOLD = 30;

async generateSQL(naturalLanguageQuery: string): Promise<string> {
  const schema = await this.getSchema();
  const metadata = await this.getMetadata();

  let finalSchema: SchemaInfo = schema;
  let finalMetadata: MetadataCache | null = metadata ?? null;

  // 2-Pass: 테이블이 임계값 초과 시 1st Pass로 관련 테이블 선별
  if (schema.tables.length > TABLE_COUNT_THRESHOLD) {
    const tableSummary = formatSchemaSummary(schema);
    const selectionPrompt = buildTableSelectionPrompt(
      tableSummary,
      metadata?.glossaryTerms ?? [],
      metadata?.glossaryAliases ?? [],
      naturalLanguageQuery
    );

    const selectionResponse = await this.aiClient.generateSQL(selectionPrompt);
    const selectedTables = parseSelectedTables(selectionResponse);

    if (selectedTables.length > 0) {
      finalSchema = filterSchemaByTables(schema, selectedTables);
      finalMetadata = filterMetadataByTables(metadata ?? null, selectedTables);
    }
    // selectedTables가 비어있으면 전체 스키마로 fallback
  }

  const prompt = buildPrompt({
    tables: finalSchema,
    naturalLanguageQuery,
    dbType: this.config.database.type,
    metadata: finalMetadata,
  });

  const response = await this.aiClient.generateSQL(prompt);
  const sql = parseSQL(response);

  const validation = validateSQL(sql);
  if (!validation.valid) {
    throw new Error(`Generated SQL is invalid: ${validation.error}`);
  }

  return sql;
}
```

**Step 3: Add necessary imports to `nl2sql-engine.ts`**

```typescript
import { formatSchemaSummary } from '../database/schema-extractor.js';
import {
  buildPrompt,
  buildTableSelectionPrompt,
  parseSelectedTables,
} from '../ai/prompt-builder.js';
```

**Step 4: Run all tests**

Run: `npm test`
Expected: All PASS

**Step 5: Run build**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/core/nl2sql-engine.ts
git commit -m "feat: integrate 2-pass table selection into generateSQL"
```

---

### Task 6: Lint, Build, Full Test

**Step 1: Lint**

Run: `npm run lint`
Expected: No errors

**Step 2: Build**

Run: `npm run build`
Expected: No errors

**Step 3: Full test suite**

Run: `npm test`
Expected: All PASS

**Step 4: Final commit if any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes for two-pass table selection"
```

---

### Task 7: Update documentation

**Files:**
- Modify: `README.md` — 2-Pass 테이블 선별 기능 언급
- Modify: `.claude/rules/mcp.md` — Version history 업데이트

**Step 1: Add to README.md Key Features section**

```markdown
- **Two-Pass table selection**: For large schemas (30+ tables), automatically selects relevant tables via a lightweight 1st pass before generating SQL, reducing token usage by ~82%
```

**Step 2: Add to `.claude/rules/mcp.md` Version History**

```markdown
### v1.4.0
- Two-Pass 테이블 선별 기능 추가 (30+ 테이블 환경에서 토큰 ~82% 절감)
- 1st Pass: 테이블명 + 코멘트 + 용어집으로 관련 테이블 선별
- 2nd Pass: 선별된 테이블의 상세 스키마로 SQL 생성
```

**Step 3: Commit**

```bash
git add README.md .claude/rules/mcp.md
git commit -m "docs: add two-pass table selection to README and MCP docs"
```
