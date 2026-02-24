# Oracle 한글 깨짐 방지 종합 개선 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Oracle US7ASCII + 한글 인코딩 환경에서 신규 기능(query_history, query_pattern_add, query_history_register)에도 한글 깨짐 방지를 적용하고, AI 프롬프트에 charset 힌트를 추가하여 생성 SQL에 UTL_RAW.CAST_TO_RAW가 자동으로 포함되도록 한다.

**Architecture:** (1) `PromptOptions`에 `oracleDataCharset` 추가 → 프롬프트에 charset 정보 및 UTL_RAW 가이드 삽입. (2) Oracle YAML에 `{{BIND_TEXT}}` / `{{NATURAL_QUERY_SELECT}}` 플레이스홀더 추가 → 런타임에 charset 유무에 따라 치환. (3) `charset-converter.ts`에 두 개의 헬퍼 함수 추출 → 모든 신규 기능에서 재사용.

**Tech Stack:** TypeScript/ESM, Knex, oracle-node-driver, iconv-lite, YAML, Jest

---

## 사전 확인

### 현재 charset 처리 방식 요약
- **설정**: `config.database.oracleDataCharset` (env: `ORACLE_DATA_CHARSET`)
- **읽기 경로**: `knex.postProcessResponse` → `createPostProcessResponse(charset)` → `convertDeep` → `convertOracleCharset` (Buffer → iconv decode)
  - Buffer로 반환되려면 SELECT에 `UTL_RAW.CAST_TO_RAW(column)` 필수
- **쓰기 경로**: `encodeForOracle(value, charset)` → hex 문자열. SQL에서 `UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(?))` 패턴 사용
- **기존 적용**: `relationship-inference.ts` (DESCRIPTION_BIND 플레이스홀더), `comment-generator.ts`

### 변경 대상 파일
1. `src/ai/prompt-builder.ts`
2. `src/core/nl2sql-engine.ts`
3. `src/database/charset-converter.ts`
4. `src/database/schemas/metadata/oracle-metadata.yaml`
5. `src/mcp/tools/query-history.ts`
6. `src/mcp/tools/query-pattern-manage.ts`
7. `src/mcp/tools/nl2sql-query.ts`
8. `tests/unit/prompt-builder.test.ts`

---

## Task 1: charset-converter.ts에 헬퍼 함수 2개 추가

**Files:**
- Modify: `src/database/charset-converter.ts`

두 개의 헬퍼 함수를 `convertResultRows` 아래에 추가한다.

**Step 1: 함수 추가**

`src/database/charset-converter.ts` 파일 끝 (`convertResultRows` 함수 바로 뒤)에 추가:

```typescript
/**
 * Oracle YAML SQL의 {{BIND_TEXT}} 플레이스홀더를 charset 유무에 따라 치환합니다.
 *
 * charset이 있으면 → UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(?))
 * charset이 없으면 → ?
 *
 * 관련 값은 반드시 encodeForOracle()로 인코딩해야 합니다.
 *
 * @param sql - {{BIND_TEXT}} 플레이스홀더를 포함한 SQL 문자열
 * @param charset - Oracle 데이터 인코딩 (예: 'ms949')
 * @returns 치환된 SQL 문자열
 */
export function resolveOracleTextBind(sql: string, charset?: string): string {
  const binding = charset
    ? 'UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(?))'
    : '?';
  return sql.replace(/\{\{BIND_TEXT\}\}/g, binding);
}

/**
 * Oracle YAML SQL의 {{NATURAL_QUERY_SELECT}} 플레이스홀더를 charset 유무에 따라 치환합니다.
 *
 * charset이 있으면 → UTL_RAW.CAST_TO_RAW(natural_query) AS natural_query
 * charset이 없으면 → natural_query
 *
 * @param sql - {{NATURAL_QUERY_SELECT}} 플레이스홀더를 포함한 SQL 문자열
 * @param charset - Oracle 데이터 인코딩 (예: 'ms949')
 * @returns 치환된 SQL 문자열
 */
export function resolveOracleNaturalQuerySelect(sql: string, charset?: string): string {
  const col = charset
    ? 'UTL_RAW.CAST_TO_RAW(natural_query) AS natural_query'
    : 'natural_query';
  return sql.replace(/\{\{NATURAL_QUERY_SELECT\}\}/g, col);
}
```

**Step 2: 빌드 확인**

```bash
npm run build 2>&1 | tail -5
```
Expected: 에러 없음

**Step 3: Commit**

```bash
git add src/database/charset-converter.ts
git commit -m "feat: add resolveOracleTextBind and resolveOracleNaturalQuerySelect helpers"
```

---

## Task 2: oracle-metadata.yaml - 쓰기 경로 플레이스홀더 추가

**Files:**
- Modify: `src/database/schemas/metadata/oracle-metadata.yaml`

**변경 대상 3개 쿼리** (`{{BIND_TEXT}}` 플레이스홀더로 교체)

### 2-A. queryPatternInsert

MATCHED THEN UPDATE SET 섹션과 NOT MATCHED VALUES 섹션에서 한글이 포함될 수 있는 필드(`pattern_name`, `description`, `example_input`)를 `{{BIND_TEXT}}`로 교체한다.

Before:
```yaml
  queryPatternInsert:
    sql: |
      MERGE INTO query_patterns tgt
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
```

After:
```yaml
  queryPatternInsert:
    sql: |
      MERGE INTO query_patterns tgt
      USING (SELECT ? AS pattern_code FROM DUAL) src
      ON (tgt.pattern_code = src.pattern_code)
      WHEN MATCHED THEN UPDATE SET
        pattern_name        = {{BIND_TEXT}},
        category            = ?,
        sql_template        = ?,
        sql_template_mysql  = ?,
        sql_template_oracle = ?,
        applicable_tables   = ?,
        description         = {{BIND_TEXT}},
        example_input       = {{BIND_TEXT}},
        updated_at          = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        pattern_code, pattern_name, category,
        sql_template, sql_template_mysql, sql_template_oracle,
        applicable_tables, match_score_threshold, priority,
        description, example_input, is_active, created_by
      ) VALUES (?, {{BIND_TEXT}}, ?, ?, ?, ?, ?, ?, ?, {{BIND_TEXT}}, {{BIND_TEXT}}, 1, 'mcp_user')
    mapping: {}
```

### 2-B. queryPatternKeywordInsert

Before:
```yaml
  queryPatternKeywordInsert:
    sql: |
      MERGE INTO pattern_keywords tgt
      USING (SELECT ? AS pattern_code, ? AS keyword FROM DUAL) src
      ON (tgt.pattern_code = src.pattern_code AND tgt.keyword = src.keyword)
      WHEN NOT MATCHED THEN INSERT (
        pattern_code, keyword, locale, weight, match_type, is_required
      ) VALUES (?, ?, 'ko', 10, 'CONTAINS', 0)
    mapping: {}
```

After:
```yaml
  queryPatternKeywordInsert:
    sql: |
      MERGE INTO pattern_keywords tgt
      USING (SELECT ? AS pattern_code, {{BIND_TEXT}} AS keyword FROM DUAL) src
      ON (tgt.pattern_code = src.pattern_code AND tgt.keyword = src.keyword)
      WHEN NOT MATCHED THEN INSERT (
        pattern_code, keyword, locale, weight, match_type, is_required
      ) VALUES (?, {{BIND_TEXT}}, 'ko', 10, 'CONTAINS', 0)
    mapping: {}
```

### 2-C. queryHistoryUpsert

NOT MATCHED VALUES의 `natural_query` 위치를 `{{BIND_TEXT}}`로 교체.

Before:
```yaml
  queryHistoryUpsert:
    sql: |
      MERGE INTO query_history tgt
      USING (SELECT ? AS query_hash FROM DUAL) src
      ON (tgt.query_hash = src.query_hash)
      WHEN MATCHED THEN UPDATE SET
        usage_count   = tgt.usage_count + 1,
        last_used_at  = SYSTIMESTAMP,
        generated_sql = ?,
        executed      = GREATEST(tgt.executed, ?)
      WHEN NOT MATCHED THEN INSERT (
        query_hash, natural_query, generated_sql, connection_id, executed
      ) VALUES (?, ?, ?, ?, ?)
    mapping: {}
```

After:
```yaml
  queryHistoryUpsert:
    sql: |
      MERGE INTO query_history tgt
      USING (SELECT ? AS query_hash FROM DUAL) src
      ON (tgt.query_hash = src.query_hash)
      WHEN MATCHED THEN UPDATE SET
        usage_count   = tgt.usage_count + 1,
        last_used_at  = SYSTIMESTAMP,
        generated_sql = ?,
        executed      = GREATEST(tgt.executed, ?)
      WHEN NOT MATCHED THEN INSERT (
        query_hash, natural_query, generated_sql, connection_id, executed
      ) VALUES (?, {{BIND_TEXT}}, ?, ?, ?)
    mapping: {}
```

**Step 1: 위 3개 쿼리를 수정**

**Step 2: Commit**

```bash
git add src/database/schemas/metadata/oracle-metadata.yaml
git commit -m "feat(oracle-yaml): add {{BIND_TEXT}} placeholders for Korean write-path fields"
```

---

## Task 3: oracle-metadata.yaml - 읽기 경로 플레이스홀더 추가

**Files:**
- Modify: `src/database/schemas/metadata/oracle-metadata.yaml`

4개 조회 쿼리의 `natural_query` 컬럼을 `{{NATURAL_QUERY_SELECT}}`로 교체.

### 3-A. queryHistoryListRecent

```yaml
  queryHistoryListRecent:
    sql: |
      SELECT id, {{NATURAL_QUERY_SELECT}}, generated_sql, connection_id,
             executed, usage_count, last_used_at, created_at
      FROM query_history
      ORDER BY last_used_at DESC
      FETCH FIRST ? ROWS ONLY
    mapping: {}
```

### 3-B. queryHistoryListFrequent

```yaml
  queryHistoryListFrequent:
    sql: |
      SELECT id, {{NATURAL_QUERY_SELECT}}, generated_sql, connection_id,
             executed, usage_count, last_used_at, created_at
      FROM query_history
      ORDER BY usage_count DESC, last_used_at DESC
      FETCH FIRST ? ROWS ONLY
    mapping: {}
```

### 3-C. queryHistorySearch

```yaml
  queryHistorySearch:
    sql: |
      SELECT id, {{NATURAL_QUERY_SELECT}}, generated_sql, connection_id,
             executed, usage_count, last_used_at, created_at
      FROM query_history
      WHERE UPPER(natural_query) LIKE UPPER(?)
      ORDER BY usage_count DESC, last_used_at DESC
      FETCH FIRST ? ROWS ONLY
    mapping: {}
```

> **주의**: WHERE의 `natural_query`는 `{{NATURAL_QUERY_SELECT}}`로 교체하지 않는다. LIKE 검색은 raw 컬럼 기준으로 유지한다.

### 3-D. queryHistoryGetById

```yaml
  queryHistoryGetById:
    sql: |
      SELECT id, {{NATURAL_QUERY_SELECT}}, generated_sql, connection_id,
             executed, usage_count, last_used_at
      FROM query_history
      WHERE id = ?
    mapping: {}
```

**Step 1: 위 4개 쿼리를 수정**

**Step 2: Commit**

```bash
git add src/database/schemas/metadata/oracle-metadata.yaml
git commit -m "feat(oracle-yaml): add {{NATURAL_QUERY_SELECT}} placeholder for Korean read-path"
```

---

## Task 4: prompt-builder.ts - PromptOptions에 charset 추가

**Files:**
- Modify: `src/ai/prompt-builder.ts`

### 4-A. PromptOptions 인터페이스에 필드 추가

```typescript
export interface PromptOptions {
  /** 테이블 정보 배열 또는 스키마 정보 */
  tables: TableInfo[] | SchemaInfo;
  /** 사용자의 자연어 쿼리 */
  naturalLanguageQuery: string;
  /** 대상 데이터베이스 타입 */
  dbType: DatabaseType;
  /** 메타데이터 캐시 (선택적) */
  metadata?: MetadataCache | null;
  /** Oracle 데이터 캐릭터셋 (US7ASCII DB에서 한글 변환용, 예: ms949) */
  oracleDataCharset?: string;
}
```

### 4-B. getDbSpecificNotes 함수 - Oracle 섹션에 charset 힌트 추가

`oracleDataCharset` 파라미터를 추가하고, charset이 있을 때 UTL_RAW 가이드를 추가한다.

현재 함수 시그니처: `function getDbSpecificNotes(dbType: DatabaseType): string`

변경 후: `function getDbSpecificNotes(dbType: DatabaseType, oracleDataCharset?: string): string`

Oracle case 부분:
```typescript
    case 'oracle': {
      const charsetNote = oracleDataCharset
        ? `\n- Character encoding: DB stores data as ${oracleDataCharset} (not UTF-8). For VARCHAR2 columns that may contain Korean text, ALWAYS wrap with UTL_RAW.CAST_TO_RAW(column) AS column_name in SELECT. Example: UTL_RAW.CAST_TO_RAW(customer_name) AS customer_name`
        : '';
      return `- Use Oracle-specific syntax (double quotes for case-sensitive identifiers)
- Use appropriate Oracle functions (e.g., NVL, TO_CHAR, TO_DATE, DECODE, etc.)
- Use FETCH FIRST n ROWS ONLY for limiting results (Oracle 12c+) or ROWNUM for older versions
- Use || for string concatenation
- NULL handling: NVL(column, default) or COALESCE
- Date literals: DATE 'YYYY-MM-DD' or TO_DATE('YYYY-MM-DD', 'YYYY-MM-DD')
- Use DUAL for queries without a table (e.g., SELECT SYSDATE FROM DUAL)${charsetNote}`;
    }
```

### 4-C. buildPrompt 함수 - charset 섹션 추가

`buildPrompt` 함수에서 charset 관련 처리:

```typescript
export function buildPrompt(options: PromptOptions): string {
  const { tables, naturalLanguageQuery, dbType, metadata, oracleDataCharset } = options;
  // ...기존 코드...

  const dbTypeLabel = oracleDataCharset
    ? `Database type: ${dbType.toUpperCase()} (data charset: ${oracleDataCharset})`
    : `Database type: ${dbType.toUpperCase()}`;

  const sections = [
    `Given the following database schema:`,
    schemaText,
    dbTypeLabel,
    `Guidelines:\n${getDbSpecificNotes(dbType, oracleDataCharset)}`,
    performanceGuidelines,
    safetyGuidelines,
  ];
  // ...나머지 기존 코드...
}
```

**Step 1: 위 3가지 변경 적용**

**Step 2: Commit**

```bash
git add src/ai/prompt-builder.ts
git commit -m "feat(prompt): add oracleDataCharset to PromptOptions and UTL_RAW hint for Oracle"
```

---

## Task 5: nl2sql-engine.ts - generateSQL에 charset 전달

**Files:**
- Modify: `src/core/nl2sql-engine.ts` (line ~281, `buildPrompt` 호출 부분)

`buildPrompt` 호출 시 `oracleDataCharset` 추가:

```typescript
    const prompt = buildPrompt({
      tables: finalSchema,
      naturalLanguageQuery,
      dbType: this.config.database.type,
      metadata: finalMetadata,
      oracleDataCharset: this.config.database.oracleDataCharset,
    });
```

**Step 1: 변경 적용**

**Step 2: 빌드 확인**

```bash
npm run build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add src/core/nl2sql-engine.ts
git commit -m "feat(engine): pass oracleDataCharset to buildPrompt for charset-aware SQL generation"
```

---

## Task 6: query-history.ts - saveQueryHistory charset 인코딩

**Files:**
- Modify: `src/mcp/tools/query-history.ts`

### 6-A. import 추가

파일 상단에 추가:
```typescript
import { encodeForOracle, resolveOracleTextBind } from '../../database/charset-converter.js';
```

### 6-B. saveQueryHistory 함수 시그니처에 oracleDataCharset 추가

```typescript
export async function saveQueryHistory(
  knex: Knex,
  dbType: DatabaseType,
  naturalQuery: string,
  generatedSql: string,
  connectionId: string,
  executed: boolean,
  oracleDataCharset?: string
): Promise<void> {
```

### 6-C. Oracle 바인딩에 charset 인코딩 적용

기존 `if (dbType === 'oracle')` 블록을 교체:

```typescript
  let sql = def.sql;
  let bindings: unknown[];
  if (dbType === 'oracle') {
    sql = resolveOracleTextBind(sql, oracleDataCharset);
    const encodedNaturalQuery = oracleDataCharset
      ? encodeForOracle(naturalQuery, oracleDataCharset)
      : naturalQuery;
    // MERGE: ON(1) + MATCHED SET(3) + NOT MATCHED INSERT(5)
    bindings = [
      hash,                  // ON: query_hash
      generatedSql,          // MATCHED: generated_sql
      execVal,               // MATCHED: executed
      hash,                  // NOT MATCHED: query_hash
      encodedNaturalQuery,   // NOT MATCHED: natural_query ({{BIND_TEXT}} 위치)
      generatedSql,          // NOT MATCHED: generated_sql
      connectionId,          // NOT MATCHED: connection_id
      execVal,               // NOT MATCHED: executed
    ];
  } else {
    bindings = [hash, naturalQuery, generatedSql, connectionId, execVal];
  }

  await knex.raw(sql, bindings);
```

**Step 1: 변경 적용**

**Step 2: Commit**

```bash
git add src/mcp/tools/query-history.ts
git commit -m "feat(query-history): encode naturalQuery with oracleDataCharset in saveQueryHistory"
```

---

## Task 7: query-history.ts - 읽기 함수들 charset SELECT 처리

**Files:**
- Modify: `src/mcp/tools/query-history.ts`

### 7-A. import 추가 (Task 6에서 이미 추가됨 - resolveOracleNaturalQuerySelect 추가)

import 문을 업데이트:
```typescript
import {
  encodeForOracle,
  resolveOracleTextBind,
  resolveOracleNaturalQuerySelect,
} from '../../database/charset-converter.js';
```

### 7-B. queryHistoryList - SELECT 플레이스홀더 치환

`queryHistoryList` 함수에서 쿼리 실행 전:

```typescript
    const rawSql = resolveOracleNaturalQuerySelect(
      def.sql,
      entry.params.type === 'oracle' ? entry.params.oracleDataCharset : undefined
    );
    const result = await entry.knex.raw(rawSql, [input.limit]);
```

### 7-C. queryHistorySearch - SELECT 플레이스홀더 치환

```typescript
    const keyword = `%${input.keyword}%`;
    const rawSql = resolveOracleNaturalQuerySelect(
      def.sql,
      entry.params.type === 'oracle' ? entry.params.oracleDataCharset : undefined
    );
    const result = await entry.knex.raw(rawSql, [keyword, input.limit]);
```

**Step 1: 변경 적용**

**Step 2: 빌드 확인**

```bash
npm run build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add src/mcp/tools/query-history.ts
git commit -m "feat(query-history): apply UTL_RAW.CAST_TO_RAW for natural_query SELECT in Oracle charset mode"
```

---

## Task 8: query-history.ts - queryHistoryRegister charset 인코딩

**Files:**
- Modify: `src/mcp/tools/query-history.ts`

`queryHistoryRegister` 함수 내에서 두 곳을 수정:

### 8-A. queryHistoryGetById - SELECT 플레이스홀더 치환

이력 조회 시 charset 적용:

```typescript
  try {
    const getByIdSql = resolveOracleNaturalQuerySelect(
      getByIdDef.sql,
      dbType === 'oracle' ? entry.params.oracleDataCharset : undefined
    );
    const result = await entry.knex.raw(getByIdSql, [input.historyId]);
    const rows = (result.rows ?? result[0] ?? []) as HistoryEntry[];
    historyRow = rows[0];
  }
```

### 8-B. queryPatternInsert - 한글 필드 인코딩

Oracle 바인딩 블록(`if (dbType === 'oracle')`)을 수정:

```typescript
    let bindings: unknown[];
    if (dbType === 'oracle') {
      const charset = entry.params.oracleDataCharset;
      const insertSql = resolveOracleTextBind(insertDef.sql, charset);

      const encodedPatternName = charset ? encodeForOracle(input.patternName, charset) : input.patternName;
      const encodedDescription = charset ? encodeForOracle(input.description, charset) : input.description;
      const encodedNaturalQuery = historyRow.natural_query && charset
        ? encodeForOracle(String(historyRow.natural_query), charset)
        : (historyRow.natural_query ?? null);

      // MERGE: ON(1) + MATCHED SET(8) + NOT MATCHED INSERT(11)
      bindings = [
        patternCode,
        encodedPatternName,      // pattern_name MATCHED
        input.category ?? null,
        historyRow.generated_sql,
        null,
        null,
        null,
        encodedDescription,      // description MATCHED
        encodedNaturalQuery,     // example_input 위치 (natural_query를 example로 사용)
        patternCode,
        encodedPatternName,      // pattern_name NOT MATCHED
        input.category ?? null,
        historyRow.generated_sql,
        null,
        null,
        null,
        70,
        100,
        encodedDescription,      // description NOT MATCHED
        encodedNaturalQuery,     // example_input NOT MATCHED
      ];

      await entry.knex.raw(insertSql, bindings);
    } else {
      // 기존 non-Oracle 바인딩 (변경 없음)
      bindings = [
        patternCode, input.patternName, input.category ?? null,
        historyRow.generated_sql, null, null, null, 70, 100,
        input.description, historyRow.natural_query,
      ];
      await entry.knex.raw(insertDef.sql, bindings);
    }
```

### 8-C. queryPatternKeywordInsert - 키워드 인코딩

```typescript
      const kwDef = config.queries.queryPatternKeywordInsert;
      if (kwDef && input.keywords && input.keywords.length > 0) {
        for (const kw of input.keywords) {
          const kwSql = resolveOracleTextBind(kwDef.sql, charset);
          const encodedKw = charset ? encodeForOracle(kw, charset) : kw;
          const kwBindings = dbType === 'oracle'
            ? [patternCode, encodedKw, patternCode, encodedKw]
            : [patternCode, kw];
          await entry.knex.raw(dbType === 'oracle' ? kwSql : kwDef.sql, kwBindings);
        }
      }
```

**Step 1: 변경 적용**

**Step 2: Commit**

```bash
git add src/mcp/tools/query-history.ts
git commit -m "feat(query-history): apply charset encoding in queryHistoryRegister for Oracle"
```

---

## Task 9: query-pattern-manage.ts - queryPatternAdd charset 인코딩

**Files:**
- Modify: `src/mcp/tools/query-pattern-manage.ts`

### 9-A. import 추가

```typescript
import { encodeForOracle, resolveOracleTextBind } from '../../database/charset-converter.js';
```

### 9-B. Oracle 바인딩 블록 수정

`queryPatternAdd` 함수 내 `if (dbType === 'oracle')` 블록:

```typescript
    let bindings: unknown[];
    if (dbType === 'oracle') {
      const charset = entry.params.oracleDataCharset;
      const mergedSql = resolveOracleTextBind(insertDef.sql, charset);

      const encodedName = charset ? encodeForOracle(input.patternName, charset) : input.patternName;
      const encodedDesc = charset ? encodeForOracle(input.description, charset) : input.description;
      const encodedExample = input.exampleInput && charset
        ? encodeForOracle(input.exampleInput, charset)
        : (input.exampleInput ?? null);

      bindings = [
        // ON (SELECT ? AS pattern_code FROM DUAL)
        patternCode,
        // WHEN MATCHED SET
        encodedName,          // pattern_name
        input.category,
        input.sqlTemplate,
        input.sqlTemplateMysql ?? null,
        input.sqlTemplateOracle ?? null,
        applicableTablesVal,
        encodedDesc,          // description
        encodedExample,       // example_input
        // WHEN NOT MATCHED INSERT VALUES
        patternCode,
        encodedName,          // pattern_name
        input.category,
        input.sqlTemplate,
        input.sqlTemplateMysql ?? null,
        input.sqlTemplateOracle ?? null,
        applicableTablesVal,
        70,
        100,
        encodedDesc,          // description
        encodedExample,       // example_input
      ];
      await entry.knex.raw(mergedSql, bindings);
    } else {
      // 기존 non-Oracle 바인딩 (변경 없음)
      bindings = [ ... ]; // 기존 코드 유지
      await entry.knex.raw(insertDef.sql, bindings);
    }
```

### 9-C. 키워드 등록 - charset 인코딩

```typescript
    if (kwDef && input.keywords && input.keywords.length > 0) {
      for (const keyword of input.keywords) {
        const charset = dbType === 'oracle' ? entry.params.oracleDataCharset : undefined;
        const kwSql = dbType === 'oracle' ? resolveOracleTextBind(kwDef.sql, charset) : kwDef.sql;
        const encodedKw = dbType === 'oracle' && charset ? encodeForOracle(keyword, charset) : keyword;
        const kwBindings: unknown[] = dbType === 'oracle'
          ? [patternCode, encodedKw, patternCode, encodedKw]
          : [patternCode, keyword];
        await entry.knex.raw(kwSql, kwBindings);
      }
    }
```

**Step 1: 변경 적용**

**Step 2: Commit**

```bash
git add src/mcp/tools/query-pattern-manage.ts
git commit -m "feat(query-pattern): apply oracleDataCharset encoding in queryPatternAdd"
```

---

## Task 10: nl2sql-query.ts - saveQueryHistory에 oracleDataCharset 전달

**Files:**
- Modify: `src/mcp/tools/nl2sql-query.ts` (line ~138)

```typescript
      // 쿼리 이력 자동 저장 (fire-and-forget, 실패해도 메인 흐름 영향 없음)
      saveQueryHistory(
        entry.knex,
        entry.params.type,
        validation.sanitized,
        sql,
        entry.connectionId,
        input.execute ?? false,
        entry.params.oracleDataCharset  // ← 추가
      ).catch(() => {});
```

**Step 1: 변경 적용**

**Step 2: Commit**

```bash
git add src/mcp/tools/nl2sql-query.ts
git commit -m "fix(nl2sql-query): pass oracleDataCharset to saveQueryHistory"
```

---

## Task 11: 테스트 업데이트 - prompt-builder.test.ts

**Files:**
- Modify: `tests/unit/prompt-builder.test.ts`

`buildPrompt` 에 대한 기존 테스트가 없다면 새로 추가. 기존 파일은 `buildTableSelectionPrompt` 테스트만 포함.

파일에 아래 describe 블록을 추가:

```typescript
import { buildPrompt } from '../../src/ai/prompt-builder.js';
import type { SchemaInfo } from '../../src/database/schema-extractor.js';

describe('buildPrompt', () => {
  const mockSchema: SchemaInfo = {
    tables: [{
      name: 'customers',
      schema: 'public',
      comment: '고객',
      columns: [{ name: 'cust_name', type: 'VARCHAR2(100)', nullable: false, comment: '고객명' }],
    }],
    recentQueries: [],
  };

  it('should include database type in prompt', () => {
    const result = buildPrompt({
      tables: mockSchema,
      naturalLanguageQuery: '고객 목록 조회',
      dbType: 'oracle',
    });
    expect(result).toContain('Database type: ORACLE');
  });

  it('should include charset info when oracleDataCharset is provided', () => {
    const result = buildPrompt({
      tables: mockSchema,
      naturalLanguageQuery: '고객 목록 조회',
      dbType: 'oracle',
      oracleDataCharset: 'ms949',
    });
    expect(result).toContain('data charset: ms949');
    expect(result).toContain('UTL_RAW.CAST_TO_RAW');
  });

  it('should NOT include charset info when oracleDataCharset is not provided', () => {
    const result = buildPrompt({
      tables: mockSchema,
      naturalLanguageQuery: '고객 목록 조회',
      dbType: 'oracle',
    });
    expect(result).not.toContain('UTL_RAW.CAST_TO_RAW');
  });

  it('should NOT include UTL_RAW hint for non-oracle databases', () => {
    const result = buildPrompt({
      tables: mockSchema,
      naturalLanguageQuery: '고객 목록 조회',
      dbType: 'postgresql',
    });
    expect(result).not.toContain('UTL_RAW');
  });
});
```

**Step 1: 테스트 추가**

**Step 2: 테스트 실행**

```bash
npx jest tests/unit/prompt-builder.test.ts --no-coverage 2>&1 | tail -20
```
Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/prompt-builder.test.ts
git commit -m "test(prompt-builder): add buildPrompt charset hint tests"
```

---

## Task 12: charset-converter.ts 헬퍼 함수 테스트 추가

**Files:**
- Create: `tests/unit/charset-converter.test.ts`

```typescript
import {
  resolveOracleTextBind,
  resolveOracleNaturalQuerySelect,
} from '../../src/database/charset-converter.js';

describe('resolveOracleTextBind', () => {
  it('should replace {{BIND_TEXT}} with ? when no charset', () => {
    const sql = 'INSERT INTO t (a) VALUES ({{BIND_TEXT}})';
    expect(resolveOracleTextBind(sql)).toBe('INSERT INTO t (a) VALUES (?)');
  });

  it('should replace {{BIND_TEXT}} with UTL_RAW pattern when charset provided', () => {
    const sql = 'INSERT INTO t (a) VALUES ({{BIND_TEXT}})';
    const result = resolveOracleTextBind(sql, 'ms949');
    expect(result).toBe('INSERT INTO t (a) VALUES (UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(?)))');
  });

  it('should replace ALL occurrences of {{BIND_TEXT}}', () => {
    const sql = 'SET a = {{BIND_TEXT}}, b = {{BIND_TEXT}}';
    const result = resolveOracleTextBind(sql, 'ms949');
    expect(result.match(/UTL_RAW/g)?.length).toBe(2);
  });
});

describe('resolveOracleNaturalQuerySelect', () => {
  it('should replace {{NATURAL_QUERY_SELECT}} with natural_query when no charset', () => {
    const sql = 'SELECT {{NATURAL_QUERY_SELECT}} FROM query_history';
    expect(resolveOracleNaturalQuerySelect(sql)).toBe('SELECT natural_query FROM query_history');
  });

  it('should replace {{NATURAL_QUERY_SELECT}} with UTL_RAW pattern when charset provided', () => {
    const sql = 'SELECT {{NATURAL_QUERY_SELECT}} FROM query_history';
    const result = resolveOracleNaturalQuerySelect(sql, 'ms949');
    expect(result).toBe('SELECT UTL_RAW.CAST_TO_RAW(natural_query) AS natural_query FROM query_history');
  });
});
```

**Step 1: 테스트 파일 생성**

**Step 2: 테스트 실행**

```bash
npx jest tests/unit/charset-converter.test.ts --no-coverage 2>&1 | tail -20
```
Expected: PASS (Task 1 완료 후)

**Step 3: Commit**

```bash
git add tests/unit/charset-converter.test.ts
git commit -m "test(charset-converter): add tests for resolveOracleTextBind and resolveOracleNaturalQuerySelect"
```

---

## Task 13: 전체 빌드 및 테스트 검증

**Step 1: 전체 테스트 실행**

```bash
npm test 2>&1 | tail -30
```
Expected: 모든 테스트 PASS

**Step 2: 전체 빌드**

```bash
npm run build 2>&1 | tail -10
```
Expected: 에러 없음

**Step 3: lint 확인**

```bash
npm run lint 2>&1 | tail -10
```
Expected: 에러 없음

---

## 구현 순서 요약

```
Task 1  (charset-converter.ts 헬퍼 추가)
  ↓
Task 2  (YAML 쓰기 경로 플레이스홀더)
  ↓
Task 3  (YAML 읽기 경로 플레이스홀더)
  ↓
Task 4  (prompt-builder.ts)
  ↓
Task 5  (nl2sql-engine.ts)
  ↓
Task 6  (query-history.ts saveQueryHistory)
  ↓
Task 7  (query-history.ts 읽기 함수)
  ↓
Task 8  (query-history.ts queryHistoryRegister)
  ↓
Task 9  (query-pattern-manage.ts)
  ↓
Task 10 (nl2sql-query.ts)
  ↓
Task 11 (prompt-builder 테스트)
  ↓
Task 12 (charset-converter 테스트)
  ↓
Task 13 (전체 검증)
```

## 주의사항

- Task 6~8은 순서대로 진행 (query-history.ts 한 파일을 여러 번 나눠 수정)
- Oracle YAML 수정 시 들여쓰기 주의 (YAML은 spaces 2칸)
- `{{BIND_TEXT}}`는 `?` 1개를 완전히 대체하므로, 바인딩 배열의 값 순서가 맞아야 함
- 기존 non-Oracle 바인딩은 변경하지 않음
