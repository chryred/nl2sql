# comment-generator Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `comment-generator.ts`의 DBMS별 if/else 반복을 설정 맵 + 전용 빌더 함수로 교체해 중복을 제거한다.

**Architecture:** `truncateComment`는 `CHAR_LIMITS` 맵과 `truncateByBytes` 헬퍼로, `buildCommentSQL`은 DBMS별 private 빌더 3개와 `COMMENT_SQL_BUILDERS` 맵으로 분리한다. `applyComments`는 공통 `applyOneByOne` 헬퍼를 추출해 mysql/oracle 중복을 제거한다. Public API 시그니처는 변경 없음.

**Tech Stack:** TypeScript, Jest (ESM), knex, js-yaml

---

### Task 1: `truncateComment` — CHAR_LIMITS 맵 + truncateByBytes 헬퍼

**Files:**
- Modify: `src/database/comment-generator.ts:374-411`
- Test: `tests/unit/comment-generator.test.ts` (기존 `truncateComment` 테스트 재사용)

**Step 1: 기존 테스트 실행 (GREEN 확인)**

```bash
npm test -- --testPathPattern=comment-generator
```

Expected: 모든 테스트 PASS

**Step 2: `truncateComment` 함수 교체**

`src/database/comment-generator.ts`의 `truncateComment` 함수 전체를 아래로 교체:

```typescript
// ─── 코멘트 길이 제한 설정 ────────────────────────────────────────────────────

const ORACLE_BYTE_LIMIT = 4000;

/** MySQL 문자 수 제한 (테이블/컬럼) */
const CHAR_LIMITS: Record<DatabaseType, { table: number; column: number } | null> = {
  postgresql: null,
  mysql: { table: 2048, column: 1024 },
  oracle: null,
};

/**
 * 바이트 단위로 문자열을 잘라냅니다 (Oracle 전용).
 */
function truncateByBytes(
  comment: string,
  limit: number
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(comment, 'utf8') <= limit) {
    return { text: comment, truncated: false };
  }
  let byteCount = 0;
  let charIdx = 0;
  while (charIdx < comment.length) {
    const charBytes = Buffer.byteLength(comment[charIdx], 'utf8');
    if (byteCount + charBytes > limit) break;
    byteCount += charBytes;
    charIdx++;
  }
  return { text: comment.slice(0, charIdx), truncated: true };
}

/**
 * DBMS별 코멘트 길이 제한을 적용합니다.
 *
 * @param comment - 원본 코멘트 문자열
 * @param dbType - 데이터베이스 타입
 * @param isTable - 테이블 코멘트 여부 (false = 컬럼 코멘트)
 * @returns 트렁케이션 결과 { text, truncated }
 */
export function truncateComment(
  comment: string,
  dbType: DatabaseType,
  isTable: boolean
): { text: string; truncated: boolean } {
  if (dbType === 'oracle') return truncateByBytes(comment, ORACLE_BYTE_LIMIT);
  const limits = CHAR_LIMITS[dbType];
  if (!limits) return { text: comment, truncated: false };
  const limit = isTable ? limits.table : limits.column;
  if (comment.length <= limit) return { text: comment, truncated: false };
  return { text: comment.slice(0, limit), truncated: true };
}
```

기존 `// ─── DBMS별 코멘트 길이 제한 설정 ───` 주석 블록도 제거한다.

**Step 3: 테스트 실행 (GREEN 확인)**

```bash
npm test -- --testPathPattern=comment-generator
```

Expected: 기존 `truncateComment` 테스트 4개 모두 PASS

**Step 4: 빌드 확인**

```bash
npm run build
```

Expected: 에러 없음

**Step 5: Commit**

```bash
git add src/database/comment-generator.ts
git commit -m "refactor: replace truncateComment if/else with CHAR_LIMITS map + truncateByBytes helper"
```

---

### Task 2: `buildCommentSQL` — DBMS별 빌더 분리 + COMMENT_SQL_BUILDERS 맵

**Files:**
- Modify: `src/database/comment-generator.ts:510-607`
- Test: `tests/unit/comment-generator.test.ts` (기존 `buildCommentSQL` 테스트 재사용)

**Step 1: 기존 테스트 실행 (GREEN 확인)**

```bash
npm test -- --testPathPattern=comment-generator --verbose
```

Expected: `buildCommentSQL` 테스트 6개 모두 PASS

**Step 2: `buildCommentSQL` 함수 블록 전체 교체**

`src/database/comment-generator.ts`의 `// ─── DBMS별 SQL 빌더 ──` 섹션부터 `buildCommentSQL` 함수 끝까지를 아래로 교체:

```typescript
// ─── DBMS별 SQL 빌더 ──────────────────────────────────────────────────────────

function buildPostgresCommentSQL(
  candidate: CommentCandidate,
  templates: CommentSQLTemplates
): { sql: string; bindings: unknown[] } {
  const isColumn = candidate.column != null && candidate.column !== '';
  const tmpl = isColumn ? templates.commentOnColumn : templates.commentOnTable;
  const sql = applyTemplate(tmpl.sql, {
    schema: candidate.schema,
    table: candidate.table,
    ...(isColumn ? { column: candidate.column as string } : {}),
  });
  return { sql, bindings: [candidate.comment] };
}

function buildMysqlCommentSQL(
  candidate: CommentCandidate,
  templates: CommentSQLTemplates,
  mysqlColumnDef?: MySQLColumnDef | null
): { sql: string; bindings: unknown[] } {
  const isColumn = candidate.column != null && candidate.column !== '';
  if (isColumn) {
    if (!mysqlColumnDef) {
      throw new Error(
        `MySQL column definition not available for ${candidate.schema}.${candidate.table}.${candidate.column}`
      );
    }
    const nullPart = mysqlColumnDef.isNullable === 'NO' ? 'NOT NULL' : 'NULL';
    const defaultPart =
      mysqlColumnDef.columnDefault !== null
        ? ` DEFAULT '${mysqlColumnDef.columnDefault.replace(/'/g, "''")}'`
        : '';
    const extraPart = mysqlColumnDef.extra ? ` ${mysqlColumnDef.extra}` : '';
    const sql = applyTemplate(templates.commentOnColumn.sql, {
      schema: candidate.schema,
      table: candidate.table,
      column: candidate.column as string,
      columnType: mysqlColumnDef.columnType,
      nullPart,
      defaultPart,
      extraPart,
    });
    return { sql, bindings: [candidate.comment] };
  }
  const sql = applyTemplate(templates.commentOnTable.sql, {
    schema: candidate.schema,
    table: candidate.table,
  });
  return { sql, bindings: [candidate.comment] };
}

function buildOracleCommentSQL(
  candidate: CommentCandidate,
  templates: CommentSQLTemplates,
  oracleDataCharset?: string
): { sql: string; bindings: unknown[] } {
  const isColumn = candidate.column != null && candidate.column !== '';
  const schemaUpper = candidate.schema.toUpperCase();
  const tableUpper = candidate.table.toUpperCase();

  if (oracleDataCharset) {
    const hexComment = encodeForOracle(candidate.comment, oracleDataCharset);
    if (isColumn) {
      const colUpper = (candidate.column as string).toUpperCase();
      const tmpl = templates.commentOnColumnWithCharset;
      if (!tmpl)
        throw new Error('commentOnColumnWithCharset SQL not found in oracle.yaml');
      const sql = applyTemplate(tmpl.sql, {
        schema: schemaUpper,
        table: tableUpper,
        column: colUpper,
      });
      return { sql, bindings: [hexComment] };
    }
    const tmpl = templates.commentOnTableWithCharset;
    if (!tmpl)
      throw new Error('commentOnTableWithCharset SQL not found in oracle.yaml');
    const sql = applyTemplate(tmpl.sql, { schema: schemaUpper, table: tableUpper });
    return { sql, bindings: [hexComment] };
  }

  const tmpl = isColumn ? templates.commentOnColumn : templates.commentOnTable;
  const sql = applyTemplate(tmpl.sql, {
    schema: schemaUpper,
    table: tableUpper,
    ...(isColumn ? { column: (candidate.column as string).toUpperCase() } : {}),
  });
  return { sql, bindings: [candidate.comment] };
}

type CommentSQLBuilderFn = (
  candidate: CommentCandidate,
  templates: CommentSQLTemplates,
  oracleDataCharset?: string,
  mysqlColumnDef?: MySQLColumnDef | null
) => { sql: string; bindings: unknown[] };

const COMMENT_SQL_BUILDERS: Record<DatabaseType, CommentSQLBuilderFn> = {
  postgresql: (c, t) => buildPostgresCommentSQL(c, t),
  mysql: (c, t, _charset, colDef) => buildMysqlCommentSQL(c, t, colDef),
  oracle: (c, t, charset) => buildOracleCommentSQL(c, t, charset),
};

/**
 * DBMS별 COMMENT SQL과 바인딩을 생성합니다.
 *
 * @param candidate - 코멘트 후보
 * @param dbType - 데이터베이스 타입
 * @param oracleDataCharset - Oracle 데이터 캐릭터셋 (한글 처리용)
 * @param mysqlColumnDef - MySQL 컬럼 정의 (컬럼 코멘트 시 필요)
 * @returns SQL 문자열과 바인딩 배열
 */
export function buildCommentSQL(
  candidate: CommentCandidate,
  dbType: DatabaseType,
  oracleDataCharset?: string,
  mysqlColumnDef?: MySQLColumnDef | null
): { sql: string; bindings: unknown[] } {
  const templates = loadCommentSQL(dbType);
  return COMMENT_SQL_BUILDERS[dbType](candidate, templates, oracleDataCharset, mysqlColumnDef);
}
```

**Step 3: 테스트 실행**

```bash
npm test -- --testPathPattern=comment-generator
```

Expected: 전체 PASS

**Step 4: 빌드 확인**

```bash
npm run build
```

Expected: 에러 없음

**Step 5: Commit**

```bash
git add src/database/comment-generator.ts
git commit -m "refactor: extract per-DBMS comment SQL builders + COMMENT_SQL_BUILDERS dispatch map"
```

---

### Task 3: `applyComments` — applyOneByOne 공통 헬퍼 추출

**Files:**
- Modify: `src/database/comment-generator.ts:618-699`
- Test: `tests/unit/comment-generator.test.ts` (기존 테스트 전체 재실행)

**Step 1: `applyComments` 함수 전체 교체**

```typescript
/**
 * mysql/oracle 공통: 개별 실행 + 에러 카운트
 */
async function applyOneByOne(
  knex: Knex,
  dbType: DatabaseType,
  candidates: CommentCandidate[],
  oracleDataCharset?: string
): Promise<{ applied: number; skipped: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      let mysqlColDef: MySQLColumnDef | null = null;
      if (dbType === 'mysql' && candidate.column != null && candidate.column !== '') {
        mysqlColDef = await getColumnDefinition(
          knex,
          candidate.schema,
          candidate.table,
          candidate.column
        );
      }
      const { sql, bindings } = buildCommentSQL(
        candidate,
        dbType,
        oracleDataCharset,
        mysqlColDef
      );
      await knex.raw(sql, bindings);
      applied++;
    } catch (e) {
      logger.warn(
        `applyComments: ${dbType} failed for ${candidate.schema}.${candidate.table}.${candidate.column ?? ''}: ${e}`
      );
      failed++;
    }
  }
  return { applied, skipped: 0, failed };
}

/**
 * 코멘트 후보를 DB에 적용합니다.
 *
 * @param knex - Knex 인스턴스
 * @param dbType - 데이터베이스 타입
 * @param candidates - 코멘트 후보 목록
 * @param oracleDataCharset - Oracle 데이터 캐릭터셋 (한글 처리용)
 * @returns 적용/건너뜀/실패 카운트
 */
export async function applyComments(
  knex: Knex,
  dbType: DatabaseType,
  candidates: CommentCandidate[],
  oracleDataCharset?: string
): Promise<{ applied: number; skipped: number; failed: number }> {
  if (candidates.length === 0) return { applied: 0, skipped: 0, failed: 0 };

  if (dbType === 'postgresql') {
    let applied = 0;
    let failed = 0;
    try {
      await knex.transaction(async (trx) => {
        for (const candidate of candidates) {
          const { sql, bindings } = buildCommentSQL(candidate, 'postgresql');
          await trx.raw(sql, bindings);
          applied++;
        }
      });
    } catch (e) {
      logger.warn(`applyComments: PostgreSQL transaction failed: ${e}`);
      failed += candidates.length - applied;
    }
    return { applied, skipped: 0, failed };
  }

  return applyOneByOne(knex, dbType, candidates, oracleDataCharset);
}
```

**Step 2: 테스트 실행**

```bash
npm test -- --testPathPattern=comment-generator
```

Expected: 전체 PASS

**Step 3: 빌드 + 린트**

```bash
npm run build && npm run lint
```

Expected: 에러 없음

**Step 4: 전체 테스트**

```bash
npm test
```

Expected: 모든 테스트 PASS

**Step 5: Commit**

```bash
git add src/database/comment-generator.ts
git commit -m "refactor: extract applyOneByOne helper, remove mysql/oracle duplication in applyComments"
```
