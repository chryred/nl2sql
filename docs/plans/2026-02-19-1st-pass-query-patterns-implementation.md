# 1st Pass Enhancement & Query Patterns MCP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 1st Pass 테이블 선별 프롬프트에 TABLE_RELATIONSHIPS/queryPatterns/patternKeywords를 추가하고, query_pattern_add / query_pattern_search MCP 도구 2종을 구현한다.

**Architecture:** (1) `buildTableSelectionPrompt` 파라미터 확장으로 관계·패턴 정보를 1st Pass에 전달. (2) `query-pattern-manage.ts` 신규 파일에서 DB INSERT + 캐시 무효화, 그리고 ILIKE 검색을 구현. SQL은 기존 YAML 파일에 추가. server.ts 8·9단계로 삽입, 기존 8~10을 10~12로 밀어낸다.

**Tech Stack:** TypeScript, Knex, Zod, js-yaml, Jest (기존 스택 그대로)

---

## 사전 확인 사항

- DB `query_patterns` 카테고리 값: `AGGREGATION | REPORT | LOOKUP | ANALYSIS | COMPARISON | TREND | RANKING | GENERAL`
  - TypeScript `PatternCategory` 타입과 다름! MCP 스키마는 DB 값 기준
- `applicable_tables` 컬럼 타입: PG=`TEXT[]`, MySQL=`JSON`, Oracle=`CLOB`
- 신규 SQL은 `src/database/schemas/metadata/{dbType}-metadata.yaml` 에 `queryPatternInsert`, `queryPatternKeywordInsert`, `queryPatternSearch` 키로 추가
- `MetadataQueryConfig.queries` 인터페이스에도 이 키를 추가해야 타입 에러 없음

---

## Task 1: MetadataQueryConfig 인터페이스 확장

**Files:**
- Modify: `src/database/metadata/types.ts` (MetadataQueryConfig 인터페이스)

**Step 1: 인터페이스에 3개 키 추가**

`MetadataQueryConfig.queries` 블록에 다음 3개 optional 필드 추가:

```typescript
queryPatternInsert?: MetadataQueryDefinition;
queryPatternKeywordInsert?: MetadataQueryDefinition;
queryPatternSearch?: MetadataQueryDefinition;
```

**Step 2: 빌드 확인**

```bash
npm run build 2>&1 | head -20
```
Expected: 에러 없음

**Step 3: Commit**

```bash
git add src/database/metadata/types.ts
git commit -m "feat: extend MetadataQueryConfig with queryPattern operation keys"
```

---

## Task 2: YAML에 SQL 추가 (3 DBMS)

**Files:**
- Modify: `src/database/schemas/metadata/postgresql-metadata.yaml`
- Modify: `src/database/schemas/metadata/mysql-metadata.yaml`
- Modify: `src/database/schemas/metadata/oracle-metadata.yaml`

각 파일의 `inferenceUpsert` 블록 **아래** (파일 끝 `ddl:` 섹션 바로 위)에 추가.

### PostgreSQL (`postgresql-metadata.yaml`)

```yaml
  # ==========================================================================
  # query_pattern_add: 쿼리 패턴 등록 (ON CONFLICT UPDATE)
  # ==========================================================================
  queryPatternInsert:
    sql: |
      INSERT INTO nl2sql.query_patterns (
        pattern_code, pattern_name, category,
        sql_template, sql_template_mysql, sql_template_oracle,
        applicable_tables, match_score_threshold, priority,
        description, example_input, is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'mcp_user')
      ON CONFLICT (pattern_code) DO UPDATE SET
        pattern_name         = EXCLUDED.pattern_name,
        category             = EXCLUDED.category,
        sql_template         = EXCLUDED.sql_template,
        sql_template_mysql   = EXCLUDED.sql_template_mysql,
        sql_template_oracle  = EXCLUDED.sql_template_oracle,
        applicable_tables    = EXCLUDED.applicable_tables,
        description          = EXCLUDED.description,
        example_input        = EXCLUDED.example_input,
        updated_at           = NOW()
    mapping: {}

  # ==========================================================================
  # query_pattern_add: 패턴 키워드 등록 (중복 무시)
  # ==========================================================================
  queryPatternKeywordInsert:
    sql: |
      INSERT INTO nl2sql.pattern_keywords (
        pattern_code, keyword, locale, weight, match_type, is_required
      ) VALUES (?, ?, 'ko', 10, 'CONTAINS', FALSE)
      ON CONFLICT DO NOTHING
    mapping: {}

  # ==========================================================================
  # query_pattern_search: 패턴명/설명 키워드 검색
  # ==========================================================================
  queryPatternSearch:
    sql: |
      SELECT
        qp.pattern_code,
        qp.pattern_name,
        qp.category,
        qp.sql_template,
        qp.description,
        qp.example_input,
        qp.applicable_tables,
        COALESCE(
          ARRAY_AGG(pk.keyword ORDER BY pk.keyword) FILTER (WHERE pk.keyword IS NOT NULL),
          ARRAY[]::TEXT[]
        ) AS keywords
      FROM nl2sql.query_patterns qp
      LEFT JOIN nl2sql.pattern_keywords pk
             ON pk.pattern_code = qp.pattern_code AND pk.is_active = TRUE
      WHERE qp.is_active = TRUE
        AND (qp.pattern_name ILIKE ? OR qp.description ILIKE ?)
      GROUP BY qp.pattern_code, qp.pattern_name, qp.category,
               qp.sql_template, qp.description, qp.example_input, qp.applicable_tables
      ORDER BY qp.priority
      LIMIT ?
    mapping: {}
```

### MySQL (`mysql-metadata.yaml`)

`inferenceUpsert` 블록 아래, `ddl:` 앞에 추가:

```yaml
  # ==========================================================================
  # query_pattern_add: 쿼리 패턴 등록
  # ==========================================================================
  queryPatternInsert:
    sql: |
      INSERT INTO nl2sql.query_patterns (
        pattern_code, pattern_name, category,
        sql_template, sql_template_mysql, sql_template_oracle,
        applicable_tables, match_score_threshold, priority,
        description, example_input, is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'mcp_user')
      ON DUPLICATE KEY UPDATE
        pattern_name        = VALUES(pattern_name),
        category            = VALUES(category),
        sql_template        = VALUES(sql_template),
        sql_template_mysql  = VALUES(sql_template_mysql),
        sql_template_oracle = VALUES(sql_template_oracle),
        applicable_tables   = VALUES(applicable_tables),
        description         = VALUES(description),
        example_input       = VALUES(example_input),
        updated_at          = NOW()
    mapping: {}

  # ==========================================================================
  # query_pattern_add: 패턴 키워드 등록 (중복 무시)
  # ==========================================================================
  queryPatternKeywordInsert:
    sql: |
      INSERT IGNORE INTO nl2sql.pattern_keywords (
        pattern_code, keyword, locale, weight, match_type, is_required
      ) VALUES (?, ?, 'ko', 10, 'CONTAINS', 0)
    mapping: {}

  # ==========================================================================
  # query_pattern_search: 패턴명/설명 키워드 검색
  # ==========================================================================
  queryPatternSearch:
    sql: |
      SELECT
        qp.pattern_code,
        qp.pattern_name,
        qp.category,
        qp.sql_template,
        qp.description,
        qp.example_input,
        qp.applicable_tables,
        GROUP_CONCAT(pk.keyword ORDER BY pk.keyword SEPARATOR ',') AS keywords
      FROM nl2sql.query_patterns qp
      LEFT JOIN nl2sql.pattern_keywords pk
             ON pk.pattern_code = qp.pattern_code AND pk.is_active = 1
      WHERE qp.is_active = 1
        AND (qp.pattern_name LIKE ? OR qp.description LIKE ?)
      GROUP BY qp.pattern_code, qp.pattern_name, qp.category,
               qp.sql_template, qp.description, qp.example_input, qp.applicable_tables
      ORDER BY qp.priority
      LIMIT ?
    mapping: {}
```

### Oracle (`oracle-metadata.yaml`)

`inferenceUpsert` 블록 아래, `ddl:` 앞에 추가:

```yaml
  # ==========================================================================
  # query_pattern_add: 쿼리 패턴 등록 (MERGE INTO)
  # ==========================================================================
  queryPatternInsert:
    sql: |
      MERGE INTO nl2sql.query_patterns tgt
      USING (SELECT ? AS pattern_code FROM DUAL) src
      ON (tgt.pattern_code = src.pattern_code)
      WHEN MATCHED THEN UPDATE SET
        pattern_name        = ?,
        category            = ?,
        sql_template        = ?,
        sql_template_mysql  = ?,
        sql_template_oracle = ?,
        applicable_tables   = ?,
        description         = ?,
        example_input       = ?,
        updated_at          = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        pattern_code, pattern_name, category,
        sql_template, sql_template_mysql, sql_template_oracle,
        applicable_tables, match_score_threshold, priority,
        description, example_input, is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'mcp_user')
    mapping: {}

  # ==========================================================================
  # query_pattern_add: 패턴 키워드 등록
  # ==========================================================================
  queryPatternKeywordInsert:
    sql: |
      MERGE INTO nl2sql.pattern_keywords tgt
      USING (SELECT ? AS pattern_code, ? AS keyword FROM DUAL) src
      ON (tgt.pattern_code = src.pattern_code AND tgt.keyword = src.keyword)
      WHEN NOT MATCHED THEN INSERT (
        pattern_code, keyword, locale, weight, match_type, is_required
      ) VALUES (?, ?, 'ko', 10, 'CONTAINS', 0)
    mapping: {}

  # ==========================================================================
  # query_pattern_search: 패턴명/설명 키워드 검색
  # ==========================================================================
  queryPatternSearch:
    sql: |
      SELECT qp.pattern_code, qp.pattern_name, qp.category,
             qp.sql_template, qp.description, qp.example_input,
             qp.applicable_tables,
             LISTAGG(pk.keyword, ',') WITHIN GROUP (ORDER BY pk.keyword) AS keywords
      FROM nl2sql.query_patterns qp
      LEFT JOIN nl2sql.pattern_keywords pk
             ON pk.pattern_code = qp.pattern_code AND pk.is_active = 1
      WHERE qp.is_active = 1
        AND (UPPER(qp.pattern_name) LIKE UPPER(?) OR UPPER(qp.description) LIKE UPPER(?))
      GROUP BY qp.pattern_code, qp.pattern_name, qp.category,
               qp.sql_template, qp.description, qp.example_input, qp.applicable_tables
      ORDER BY qp.priority
      FETCH FIRST ? ROWS ONLY
    mapping: {}
```

**Step 1: YAML에 위 내용 추가 (파일 3개)**

**Step 2: 빌드 확인**

```bash
npm run build 2>&1 | head -20
```
Expected: 에러 없음

**Step 3: Commit**

```bash
git add src/database/schemas/metadata/
git commit -m "feat: add queryPatternInsert/KeywordInsert/Search SQL to metadata YAML"
```

---

## Task 3: buildTableSelectionPrompt 테스트 업데이트 (TDD - 실패 확인)

**Files:**
- Modify: `tests/unit/prompt-builder.test.ts`

**Step 1: import에 타입 추가**

파일 상단 import를 다음으로 변경:

```typescript
import { buildTableSelectionPrompt, parseSelectedTables } from '../../src/ai/prompt-builder.js';
import type {
  GlossaryTerm,
  GlossaryAlias,
  TableRelationship,
  QueryPattern,
  PatternKeyword,
} from '../../src/database/metadata/types.js';
```

**Step 2: 기존 테스트 호출부 수정 (빈 배열 추가)**

기존 `buildTableSelectionPrompt(tableSummary, glossaryTerms, glossaryAliases, 'xxx')` 호출을 모두:

```typescript
buildTableSelectionPrompt(tableSummary, glossaryTerms, glossaryAliases, [], [], [], 'xxx')
```

으로 변경 (5개 호출, `'VIP고객정보를 조회해줘'` 또는 `'test'` 문자열 앞에 `[], [], []` 삽입)

**Step 3: 관계 정보 테스트 추가** (파일 끝 `describe('parseSelectedTables'...` 블록 앞에 삽입)

```typescript
describe('buildTableSelectionPrompt with relationships', () => {
  const tableSummary = 'public.orders -- 주문\npublic.customers -- 고객';
  const relationships: TableRelationship[] = [
    {
      sourceSchema: 'public',
      sourceTable: 'orders',
      sourceColumn: 'customer_id',
      targetSchema: 'public',
      targetTable: 'customers',
      targetColumn: 'id',
      relationshipType: 'MANY_TO_ONE',
      confidence: 'HIGH',
    },
  ];

  it('should include relationship info when provided', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], relationships, [], [], '주문한 고객 목록'
    );
    expect(result).toContain('orders.customer_id');
    expect(result).toContain('customers.id');
  });

  it('should skip relationships section when empty', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], [], [], [], '주문 목록'
    );
    expect(result).not.toContain('Table Relationships');
  });
});

describe('buildTableSelectionPrompt with queryPattern hints', () => {
  const tableSummary = 'public.orders -- 주문';
  const queryPatterns: QueryPattern[] = [
    {
      patternCode: 'monthly_agg',
      patternName: 'Monthly Aggregation',
      category: 'AGGREGATION',
      sqlTemplate: 'SELECT ...',
      applicableTables: ['orders', 'order_items'],
      matchScoreThreshold: 70,
      priority: 100,
    },
  ];
  const patternKeywords: PatternKeyword[] = [
    {
      patternCode: 'monthly_agg',
      keyword: '월별',
      weight: 10,
      matchType: 'CONTAINS',
      isRequired: false,
    },
  ];

  it('should include query pattern table hints', () => {
    const result = buildTableSelectionPrompt(
      tableSummary, [], [], [], queryPatterns, patternKeywords, '월별 매출'
    );
    expect(result).toContain('Monthly Aggregation');
    expect(result).toContain('orders');
    expect(result).toContain('월별');
  });
});
```

**Step 4: 테스트 실행 → 실패 확인**

```bash
npm test -- --testPathPattern=prompt-builder 2>&1 | tail -20
```
Expected: FAIL (파라미터 개수 불일치 에러)

**Step 5: Commit (실패 테스트 포함)**

```bash
git add tests/unit/prompt-builder.test.ts
git commit -m "test: update prompt-builder tests for new relationships/patterns params"
```

---

## Task 4: buildTableSelectionPrompt 구현 업데이트

**Files:**
- Modify: `src/ai/prompt-builder.ts`

**Step 1: import에 타입 추가**

파일 상단 import 블록에 `TableRelationship, QueryPattern, PatternKeyword` 추가:

```typescript
import type {
  MetadataCache,
  TableRelationship,
  QueryPattern,
  PatternKeyword,
  GlossaryTerm,
  GlossaryAlias,
} from '../database/metadata/types.js';
```

**Step 2: `buildTableSelectionPrompt` 시그니처 및 본문 교체**

현재 함수 전체를 다음으로 교체:

```typescript
export function buildTableSelectionPrompt(
  tableSummary: string,
  glossaryTerms: GlossaryTerm[],
  glossaryAliases: GlossaryAlias[],
  relationships: TableRelationship[],
  queryPatterns: QueryPattern[],
  patternKeywords: PatternKeyword[],
  naturalLanguageQuery: string
): string {
  const sections: string[] = [];

  sections.push(`Available Tables:\n${tableSummary}`);

  // 테이블 관계 (JOIN 결정용)
  if (relationships.length > 0) {
    const relLines = relationships.map(
      (r) =>
        `  - ${r.sourceTable}.${r.sourceColumn} → ${r.targetTable}.${r.targetColumn} (${r.relationshipType})`
    );
    sections.push(`Table Relationships (use these for JOIN decisions):\n${relLines.join('\n')}`);
  }

  // 용어집
  if (glossaryTerms.length > 0) {
    const termLines = glossaryTerms.map((t) => {
      const aliases = glossaryAliases
        .filter((a) => a.termCode === t.termCode)
        .map((a) => a.alias);
      const aliasPart = aliases.length > 0 ? ` (also: ${aliases.join(', ')})` : '';
      const tableHint = t.applyToTables?.length
        ? ` [tables: ${t.applyToTables.join(', ')}]`
        : '';
      return `  - "${t.term}"${aliasPart} → ${t.sqlCondition}${tableHint}`;
    });
    sections.push(`Business Terms:\n${termLines.join('\n')}`);
  }

  // queryPatterns 테이블 힌트 (applicableTables만, SQL 없음)
  if (queryPatterns.length > 0) {
    const hintLines = queryPatterns
      .filter((p) => p.applicableTables && p.applicableTables.length > 0)
      .map((p) => `  - "${p.patternName}" → related tables: [${p.applicableTables!.join(', ')}]`);
    if (hintLines.length > 0) {
      sections.push(`Query Pattern Table Hints:\n${hintLines.join('\n')}`);
    }
  }

  // patternKeywords → 패턴 → 테이블 힌트
  if (patternKeywords.length > 0 && queryPatterns.length > 0) {
    const kwMap = new Map<string, string[]>();
    patternKeywords.forEach((kw) => {
      const existing = kwMap.get(kw.patternCode) ?? [];
      existing.push(kw.keyword);
      kwMap.set(kw.patternCode, existing);
    });

    const kwLines: string[] = [];
    kwMap.forEach((keywords, patternCode) => {
      const pattern = queryPatterns.find((p) => p.patternCode === patternCode);
      if (pattern?.applicableTables?.length) {
        kwLines.push(
          `  - Keywords [${keywords.join(', ')}] → "${pattern.patternName}" pattern → tables: [${pattern.applicableTables.join(', ')}]`
        );
      }
    });
    if (kwLines.length > 0) {
      sections.push(`Pattern Keywords → Table Hints:\n${kwLines.join('\n')}`);
    }
  }

  sections.push(`User question: ${naturalLanguageQuery}`);

  return sections.join('\n\n');
}
```

**Step 3: 테스트 실행 → 통과 확인**

```bash
npm test -- --testPathPattern=prompt-builder 2>&1 | tail -20
```
Expected: PASS (전체 테스트 통과)

**Step 4: Commit**

```bash
git add src/ai/prompt-builder.ts
git commit -m "feat: enhance buildTableSelectionPrompt with relationships and pattern hints"
```

---

## Task 5: nl2sql-engine.ts 호출부 업데이트

**Files:**
- Modify: `src/core/nl2sql-engine.ts` (line ~242 의 buildTableSelectionPrompt 호출)

**Step 1: 호출부 수정**

현재:
```typescript
const selectionPrompt = buildTableSelectionPrompt(
  tableSummary,
  metadata?.glossaryTerms ?? [],
  metadata?.glossaryAliases ?? [],
  naturalLanguageQuery
);
```

변경 후:
```typescript
const selectionPrompt = buildTableSelectionPrompt(
  tableSummary,
  metadata?.glossaryTerms ?? [],
  metadata?.glossaryAliases ?? [],
  metadata?.relationships ?? [],
  metadata?.queryPatterns ?? [],
  metadata?.patternKeywords ?? [],
  naturalLanguageQuery
);
```

**Step 2: 빌드 + 전체 테스트**

```bash
npm run build 2>&1 | head -20 && npm test 2>&1 | tail -20
```
Expected: 빌드 성공, 모든 테스트 통과

**Step 3: Commit**

```bash
git add src/core/nl2sql-engine.ts
git commit -m "feat: pass relationships and pattern hints to 1st pass table selection"
```

---

## Task 6: query-pattern-manage.ts 테스트 작성 (TDD)

**Files:**
- Create: `tests/unit/query-pattern-manage.test.ts`

**Step 1: 테스트 파일 작성**

```typescript
/**
 * query-pattern-manage.ts 유닛 테스트
 */
import { buildPatternCode, parseKeywordsResult } from '../../src/mcp/tools/query-pattern-manage.js';

describe('buildPatternCode', () => {
  it('should convert Korean/spaces to snake_case with suffix', () => {
    const code = buildPatternCode('월별 매출 집계');
    expect(code).toMatch(/^[a-z0-9_]+_[0-9a-f]{4}$/);
  });

  it('should handle English names', () => {
    const code = buildPatternCode('Monthly Sales Report');
    expect(code).toMatch(/^monthly_sales_report_[0-9a-f]{4}$/);
  });

  it('should be lowercase', () => {
    const code = buildPatternCode('TOP Sales');
    expect(code).toMatch(/^top_sales_[0-9a-f]{4}$/);
  });
});

describe('parseKeywordsResult', () => {
  it('should parse PostgreSQL array result', () => {
    const result = parseKeywordsResult('{월별,monthly,매출}');
    expect(result).toEqual(['월별', 'monthly', '매출']);
  });

  it('should parse MySQL GROUP_CONCAT result', () => {
    const result = parseKeywordsResult('월별,monthly,매출');
    expect(result).toEqual(['월별', 'monthly', '매출']);
  });

  it('should return empty array for null/undefined', () => {
    expect(parseKeywordsResult(null)).toEqual([]);
    expect(parseKeywordsResult(undefined)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(parseKeywordsResult('')).toEqual([]);
  });
});
```

**Step 2: 테스트 실행 → 실패 확인**

```bash
npm test -- --testPathPattern=query-pattern-manage 2>&1 | tail -15
```
Expected: FAIL (모듈을 찾을 수 없음)

**Step 3: Commit (실패 테스트 포함)**

```bash
git add tests/unit/query-pattern-manage.test.ts
git commit -m "test: add query-pattern-manage unit tests (TDD - failing)"
```

---

## Task 7: query-pattern-manage.ts 구현

**Files:**
- Create: `src/mcp/tools/query-pattern-manage.ts`

**Step 1: 파일 전체 작성**

```typescript
/**
 * MCP Tool: query_pattern_add / query_pattern_search
 *
 * query_pattern_add  - 자주 사용하는 쿼리 패턴을 DB에 등록하고 캐시 갱신
 * query_pattern_search - 패턴명/설명 키워드로 패턴 검색
 */
import { z } from 'zod';
import { maskSensitiveInfo } from '../../errors/index.js';
import { loadMetadataQueries } from '../../database/metadata/query-loader.js';
import type { ConnectionManager } from '../../database/connection-manager.js';

// ============================================================================
// 공통 유틸
// ============================================================================

/** patternName → snake_case + 4자리 hex suffix */
export function buildPatternCode(patternName: string): string {
  const base = patternName
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/[가-힣]+/g, 'k')  // 한글은 'k'로 치환
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `${base}_${suffix}`;
}

/** DB에서 반환된 keywords 컬럼 파싱 (PG array string / CSV 모두 처리) */
export function parseKeywordsResult(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  // PostgreSQL: {키워드1,키워드2}
  if (typeof raw === 'string' && raw.startsWith('{')) {
    return raw.slice(1, -1).split(',').filter(Boolean);
  }
  // MySQL/Oracle: CSV
  if (typeof raw === 'string') {
    return raw.split(',').filter(Boolean);
  }
  // PostgreSQL array (드라이버가 이미 파싱한 경우)
  if (Array.isArray(raw)) {
    return (raw as unknown[]).map(String).filter(Boolean);
  }
  return [];
}

// ============================================================================
// query_pattern_add
// ============================================================================

const PATTERN_CATEGORIES = [
  'AGGREGATION', 'REPORT', 'LOOKUP', 'ANALYSIS',
  'COMPARISON', 'TREND', 'RANKING', 'GENERAL',
] as const;

export const queryPatternAddInputSchema = z.object({
  connectionId: z.string().optional(),
  patternName: z.string().min(1).max(200),
  category: z.enum(PATTERN_CATEGORIES),
  sqlTemplate: z.string().min(1),
  sqlTemplateMysql: z.string().optional(),
  sqlTemplateOracle: z.string().optional(),
  description: z.string().min(1),
  exampleInput: z.string().optional(),
  applicableTables: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
});

export type QueryPatternAddInput = z.infer<typeof queryPatternAddInputSchema>;

export interface QueryPatternAddOutput {
  success: boolean;
  message: string;
  patternCode?: string;
  connectionId?: string;
  error?: string;
}

export async function queryPatternAdd(
  input: QueryPatternAddInput,
  connManager: ConnectionManager
): Promise<QueryPatternAddOutput> {
  const entry = connManager.resolve(input.connectionId);
  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
    };
  }

  const patternCode = buildPatternCode(input.patternName);
  const dbType = entry.params.type;

  try {
    const config = loadMetadataQueries(dbType);
    const insertDef = config.queries.queryPatternInsert;
    if (!insertDef) {
      return { success: false, message: `queryPatternInsert SQL not defined for ${dbType}` };
    }

    // applicable_tables: PG=TEXT[], MySQL/Oracle=JSON string
    const applicableTablesVal =
      dbType === 'postgresql'
        ? input.applicableTables ?? null
        : input.applicableTables
          ? JSON.stringify(input.applicableTables)
          : null;

    // Oracle MERGE INTO는 바인딩 순서가 다름 (UPDATE params + INSERT params)
    let bindings: unknown[];
    if (dbType === 'oracle') {
      bindings = [
        // ON clause
        patternCode,
        // WHEN MATCHED SET
        input.patternName, input.category,
        input.sqlTemplate, input.sqlTemplateMysql ?? null, input.sqlTemplateOracle ?? null,
        applicableTablesVal,
        input.description, input.exampleInput ?? null,
        // WHEN NOT MATCHED INSERT VALUES
        patternCode, input.patternName, input.category,
        input.sqlTemplate, input.sqlTemplateMysql ?? null, input.sqlTemplateOracle ?? null,
        applicableTablesVal, 70, 100,
        input.description, input.exampleInput ?? null,
      ];
    } else {
      bindings = [
        patternCode, input.patternName, input.category,
        input.sqlTemplate, input.sqlTemplateMysql ?? null, input.sqlTemplateOracle ?? null,
        applicableTablesVal, 70, 100,
        input.description, input.exampleInput ?? null,
      ];
    }

    await entry.knex.raw(insertDef.sql, bindings);

    // 키워드 등록
    const kwDef = config.queries.queryPatternKeywordInsert;
    if (kwDef && input.keywords && input.keywords.length > 0) {
      for (const keyword of input.keywords) {
        if (dbType === 'oracle') {
          await entry.knex.raw(kwDef.sql, [patternCode, keyword, patternCode, keyword]);
        } else {
          await entry.knex.raw(kwDef.sql, [patternCode, keyword]);
        }
      }
    }

    // 캐시 무효화 (다음 쿼리 시 자동 재로드)
    connManager.invalidateCache(entry.connectionId);

    return {
      success: true,
      message: `Pattern '${input.patternName}' registered as '${patternCode}'`,
      patternCode,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to add query pattern',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

// ============================================================================
// query_pattern_search
// ============================================================================

export const queryPatternSearchInputSchema = z.object({
  connectionId: z.string().optional(),
  keyword: z.string().min(1),
  limit: z.number().int().positive().default(10),
});

export type QueryPatternSearchInput = z.infer<typeof queryPatternSearchInputSchema>;

export interface PatternSearchResult {
  patternCode: string;
  patternName: string;
  category: string;
  sqlTemplate: string;
  description?: string;
  exampleInput?: string;
  applicableTables: string[];
  keywords: string[];
}

export interface QueryPatternSearchOutput {
  success: boolean;
  message?: string;
  patterns?: PatternSearchResult[];
  connectionId?: string;
  error?: string;
}

export async function queryPatternSearch(
  input: QueryPatternSearchInput,
  connManager: ConnectionManager
): Promise<QueryPatternSearchOutput> {
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
    const config = loadMetadataQueries(entry.params.type);
    const searchDef = config.queries.queryPatternSearch;
    if (!searchDef) {
      return {
        success: false,
        message: `queryPatternSearch SQL not defined for ${entry.params.type}`,
      };
    }

    const likeKeyword = `%${input.keyword}%`;
    const result = await entry.knex.raw(searchDef.sql, [
      likeKeyword,
      likeKeyword,
      input.limit,
    ]);

    // 드라이버별 rows 추출
    let rows: Record<string, unknown>[];
    if (entry.params.type === 'postgresql') {
      rows = (result.rows as Record<string, unknown>[]) ?? [];
    } else if (entry.params.type === 'mysql') {
      rows = (result[0] as Record<string, unknown>[]) ?? [];
    } else {
      rows = (result.rows as Record<string, unknown>[]) ?? [];
    }

    const patterns: PatternSearchResult[] = rows.map((row) => ({
      patternCode: String(row.pattern_code ?? ''),
      patternName: String(row.pattern_name ?? ''),
      category: String(row.category ?? ''),
      sqlTemplate: String(row.sql_template ?? ''),
      description: row.description != null ? String(row.description) : undefined,
      exampleInput: row.example_input != null ? String(row.example_input) : undefined,
      applicableTables: parseKeywordsResult(row.applicable_tables),
      keywords: parseKeywordsResult(row.keywords),
    }));

    return {
      success: true,
      patterns,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to search query patterns',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}
```

**Step 2: 테스트 실행 → 통과 확인**

```bash
npm test -- --testPathPattern=query-pattern-manage 2>&1 | tail -15
```
Expected: PASS

**Step 3: 빌드 확인**

```bash
npm run build 2>&1 | head -20
```
Expected: 에러 없음

**Step 4: Commit**

```bash
git add src/mcp/tools/query-pattern-manage.ts
git commit -m "feat: implement query_pattern_add and query_pattern_search MCP tool logic"
```

---

## Task 8: server.ts에 새 도구 등록 + 단계 번호 갱신

**Files:**
- Modify: `src/mcp/server.ts`

**Step 1: import 추가**

파일 상단 import 블록에 추가:

```typescript
import {
  queryPatternAdd,
  queryPatternAddInputSchema,
  queryPatternSearch,
  queryPatternSearchInputSchema,
} from './tools/query-pattern-manage.js';
```

**Step 2: 버전 변경**

`new McpServer({ name: 'nl2sql-mcp', version: '1.2.0' })` → `version: '1.5.0'`

**Step 3: 8단계 추가 (infer_relationships 등록 블록 바로 아래, nl2sql_schema 블록 위)**

```typescript
  // 8단계: query_pattern_add - 자주 사용하는 쿼리 패턴 등록
  server.registerTool(
    'query_pattern_add',
    {
      description:
        'Register a frequently used query pattern into the database. ' +
        'The pattern will be available for future SQL generation hints. ' +
        'Optionally specify connectionId.',
      inputSchema: queryPatternAddInputSchema,
    },
    async (args) => {
      const input = queryPatternAddInputSchema.parse(args);
      const result = await queryPatternAdd(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 9단계: query_pattern_search - 쿼리 패턴 키워드 검색
  server.registerTool(
    'query_pattern_search',
    {
      description:
        'Search registered query patterns by keyword (matches patternName or description). ' +
        'Returns matching patterns with their SQL templates and keywords. ' +
        'Optionally specify connectionId.',
      inputSchema: queryPatternSearchInputSchema,
    },
    async (args) => {
      const input = queryPatternSearchInputSchema.parse(args);
      const result = await queryPatternSearch(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
```

**Step 4: 기존 단계 주석 번호 갱신**

- `// 8단계: nl2sql_schema` → `// 10단계: nl2sql_schema`
- `// 9단계: nl2sql_query` → `// 11단계: nl2sql_query`
- `// 10단계: db_disconnect` → `// 12단계: db_disconnect`

**Step 5: 빌드 + 전체 테스트**

```bash
npm run build 2>&1 | head -30 && npm test 2>&1 | tail -20
```
Expected: 빌드 성공, 모든 테스트 통과

**Step 6: Lint 확인**

```bash
npm run lint 2>&1 | head -20
```
Expected: 에러 없음

**Step 7: Commit**

```bash
git add src/mcp/server.ts src/mcp/tools/query-pattern-manage.ts
git commit -m "feat: register query_pattern_add and query_pattern_search as MCP tools (steps 8-9)"
```

---

## Task 9: 문서 업데이트

**Files:**
- Modify: `README.md`
- Modify: `.claude/rules/mcp.md`

**Step 1: README.md MCP Tools 표에 행 추가**

`infer_relationships` 행 아래에:

```markdown
| `query_pattern_add` | 자주 사용하는 쿼리 패턴 DB 등록 (캐시 자동 갱신) |
| `query_pattern_search` | 패턴명/설명 키워드로 쿼리 패턴 검색 |
```

**Step 2: `.claude/rules/mcp.md` 도구 표에 2행 추가**

`infer_relationships` 행 아래에:

```markdown
| `query_pattern_add` | 자주 사용하는 쿼리 패턴 등록 (DB 저장 + 캐시 자동 갱신) |
| `query_pattern_search` | 패턴명/설명 키워드로 쿼리 패턴 검색 및 조회 |
```

**Step 3: `.claude/rules/mcp.md` Version History에 v1.5.0 추가**

`### v1.4.0` 블록 위에:

```markdown
### v1.5.0
- 1st Pass 테이블 선별 프롬프트 강화 (TABLE_RELATIONSHIPS, queryPatterns 힌트, patternKeywords 추가)
- JOIN 필요 테이블 누락 방지: 관계 정보 기반으로 관련 테이블 자동 포함
- `query_pattern_add` MCP 도구 추가: 자주 사용하는 쿼리 패턴 DB 등록 + 캐시 자동 갱신
- `query_pattern_search` MCP 도구 추가: 패턴명/설명 키워드 검색 (ILIKE)
- MCP 도구 12단계 체계로 확장 (기존 10단계)
```

**Step 4: Commit**

```bash
git add README.md .claude/rules/mcp.md
git commit -m "docs: update README and mcp.md for v1.5.0 changes"
```

---

## 최종 검증

```bash
npm run build && npm run lint && npm test
```
Expected: 전체 통과

---

## 구현 순서 요약

| Task | 핵심 작업 | 예상 소요 |
|------|-----------|-----------|
| 1 | MetadataQueryConfig 인터페이스 확장 | 5분 |
| 2 | YAML 3개 파일에 SQL 추가 | 15분 |
| 3 | prompt-builder 테스트 업데이트 (실패 먼저) | 10분 |
| 4 | buildTableSelectionPrompt 구현 | 10분 |
| 5 | nl2sql-engine.ts 호출부 수정 | 5분 |
| 6 | query-pattern-manage 테스트 작성 (실패 먼저) | 10분 |
| 7 | query-pattern-manage.ts 구현 | 20분 |
| 8 | server.ts 도구 등록 + 번호 갱신 | 10분 |
| 9 | 문서 업데이트 | 5분 |
