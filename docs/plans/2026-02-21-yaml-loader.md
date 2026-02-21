# YAML Loader Unification - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 3 separate YAML loading implementations with a single cached `loadYaml<T>()` utility so the same `.yaml` file is never parsed more than once.

**Architecture:** New `src/database/yaml-loader.ts` exports `loadYaml<T>(relativePath)` (paths relative to `src/database/`) backed by a module-level `Map` cache. Three consumer files (`schema-loader.ts`, `query-loader.ts`, `comment-generator.ts`) are refactored to call `loadYaml` instead of their own `readFileSync + yaml.load` logic. Because `schema-loader` and `comment-generator` load the same `schemas/{db}.yaml`, they now share one cached parse result.

**Tech Stack:** Node.js `fs.readFileSync`, `js-yaml`, `ts-jest/ESM`, Jest for testing.

**Design Doc:** `docs/plans/2026-02-21-yaml-loader-design.md`

---

## Pre-flight

Confirm tests pass before starting:
```bash
npm test
```
Expected: **205 tests pass, 0 failures**

---

### Task 1: Create `yaml-loader.ts` (TDD)

**Files:**
- Create: `src/database/yaml-loader.ts`
- Create: `tests/unit/yaml-loader.test.ts`

---

**Step 1: Write the failing test**

Create `tests/unit/yaml-loader.test.ts`:

```typescript
import { loadYaml, clearYamlCache } from '../../src/database/yaml-loader.js';

describe('loadYaml', () => {
  afterEach(() => clearYamlCache());

  it('YAML 파일을 파싱하여 반환한다', () => {
    const result = loadYaml<{ queries: unknown }>('schemas/postgresql.yaml');
    expect(result).toHaveProperty('queries');
  });

  it('같은 경로를 두 번 호출하면 동일 객체 참조를 반환한다 (캐시 히트)', () => {
    const a = loadYaml('schemas/postgresql.yaml');
    const b = loadYaml('schemas/postgresql.yaml');
    expect(a).toBe(b);
  });

  it('다른 경로는 독립적으로 캐싱된다', () => {
    const a = loadYaml('schemas/postgresql.yaml');
    const b = loadYaml('schemas/mysql.yaml');
    expect(a).not.toBe(b);
  });

  it('clearYamlCache 후 재호출하면 새 객체를 반환한다', () => {
    const a = loadYaml('schemas/postgresql.yaml');
    clearYamlCache();
    const b = loadYaml('schemas/postgresql.yaml');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('존재하지 않는 경로는 에러를 throw한다', () => {
    expect(() => loadYaml('schemas/does-not-exist.yaml')).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/yaml-loader.test.ts --no-coverage
```
Expected: **FAIL** — "Cannot find module '../../src/database/yaml-loader.js'"

---

**Step 3: Implement `src/database/yaml-loader.ts`**

```typescript
/**
 * YAML 파일 캐시 로더
 *
 * @description
 * YAML 파일을 한 번만 파싱하고 결과를 캐시합니다.
 * schema-loader, query-loader, comment-generator가 공유합니다.
 *
 * @module database/yaml-loader
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

// dist/database/ 또는 src/database/ (ts-jest 환경) 기준
const _dir = dirname(fileURLToPath(import.meta.url));

// 경로 → 파싱 결과 캐시 (프로세스 수명 동안 유지)
const _cache = new Map<string, unknown>();

/**
 * YAML 파일을 로드하고 결과를 캐싱합니다.
 *
 * @param relativePath - src/database/ 기준 상대 경로
 *                       예) 'schemas/postgresql.yaml'
 *                           'schemas/metadata/postgresql-metadata.yaml'
 * @returns 파싱된 YAML 객체
 * @throws 파일 없음(ENOENT) 또는 YAML 파싱 실패 시 에러
 */
export function loadYaml<T>(relativePath: string): T {
  if (_cache.has(relativePath)) return _cache.get(relativePath) as T;
  const absPath = join(_dir, relativePath);
  const result = yaml.load(readFileSync(absPath, 'utf8')) as T;
  _cache.set(relativePath, result);
  return result;
}

/**
 * 캐시를 비웁니다 (테스트용).
 */
export function clearYamlCache(): void {
  _cache.clear();
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/yaml-loader.test.ts --no-coverage
```
Expected: **5 tests PASS**

**Step 5: Build 확인**

```bash
npm run build
```
Expected: 에러 없음

**Step 6: Commit**

```bash
git add src/database/yaml-loader.ts tests/unit/yaml-loader.test.ts
git commit -m "feat: add shared cached yaml loader utility"
```

---

### Task 2: Migrate `schema-loader.ts`

**Files:**
- Modify: `src/database/schema-loader.ts`

**Step 1: import 변경 및 `loadQueries()` 교체**

`src/database/schema-loader.ts` 상단에서 다음 4개 import를 **제거**:
```typescript
// 제거
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
```

다음을 **추가**:
```typescript
import { loadYaml } from './yaml-loader.js';
```

`loadQueries()` 메서드 전체를 아래로 교체:
```typescript
private loadQueries(dbType: DatabaseType): SchemaQueries {
  return loadYaml<SchemaQueries>(`schemas/${dbType}.yaml`);
}
```

**Step 2: Build + 전체 테스트**

```bash
npm run build && npm test
```
Expected: **빌드 성공, 전체 테스트 통과**

**Step 3: Commit**

```bash
git add src/database/schema-loader.ts
git commit -m "refactor: use shared yaml-loader in schema-loader"
```

---

### Task 3: Migrate `metadata/query-loader.ts`

**Files:**
- Modify: `src/database/metadata/query-loader.ts`

**Step 1: import 변경**

다음 5개 import를 **제거**:
```typescript
// 제거
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
```
그리고 **모듈 레벨 `__dirname`/`__filename` 선언 2줄도 제거**:
```typescript
// 제거
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

다음을 **추가**:
```typescript
import { loadYaml } from '../yaml-loader.js';
```

**Step 2: `getQueryFilePath()` 함수 전체 삭제**

`getQueryFilePath` 함수(line 27~66, 3단 폴백 로직)를 **완전히 제거**합니다.

**Step 3: `loadMetadataQueries()` 교체**

```typescript
export function loadMetadataQueries(dbType: DatabaseType): MetadataQueryConfig {
  const config = loadYaml<MetadataQueryConfig>(
    `schemas/metadata/${dbType}-metadata.yaml`
  );
  if (!config?.queries) {
    throw new Error(`Invalid metadata query configuration for ${dbType}`);
  }
  return config;
}
```

**Step 4: Build + 전체 테스트**

```bash
npm run build && npm test
```
Expected: **빌드 성공, 전체 테스트 통과**

**Step 5: Commit**

```bash
git add src/database/metadata/query-loader.ts
git commit -m "refactor: use shared yaml-loader in query-loader, remove 3-path fallback"
```

---

### Task 4: Migrate `comment-generator.ts`

**Files:**
- Modify: `src/database/comment-generator.ts`

**Step 1: import 변경**

다음 4개 import를 **제거**:
```typescript
// 제거
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
```

다음을 **추가**:
```typescript
import { loadYaml } from './yaml-loader.js';
```

**Step 2: `_commentSQLCache` Map 삭제**

아래 줄을 **삭제**:
```typescript
const _commentSQLCache = new Map<string, CommentSQLTemplates>();
```

**Step 3: `loadCommentSQL()` 함수 교체**

```typescript
function loadCommentSQL(dbType: DatabaseType): CommentSQLTemplates {
  return loadYaml<{ comments: CommentSQLTemplates }>(
    `schemas/${dbType}.yaml`
  ).comments;
}
```
> ※ `schema-loader.ts`와 `schemas/{db}.yaml` 캐시를 공유 — 동일 YAML 파싱 1회

**Step 4: Build + 전체 테스트**

```bash
npm run build && npm test
```
Expected: **빌드 성공, 전체 테스트 통과 (210+ tests)**

**Step 5: Lint 확인**

```bash
npx eslint src/database/yaml-loader.ts src/database/schema-loader.ts src/database/metadata/query-loader.ts src/database/comment-generator.ts
```
Expected: 새로 추가된 에러 없음

**Step 6: Commit**

```bash
git add src/database/comment-generator.ts
git commit -m "refactor: use shared yaml-loader in comment-generator, remove local cache"
```

---

### Task 5: Final Verification

**Step 1: 전체 빌드 + 전체 테스트**

```bash
npm run build && npm test
```
Expected: **모든 테스트 통과**

**Step 2: 중복 코드 잔재 없음 확인**

```bash
grep -rn "readFileSync\|yaml\.load\|fileURLToPath" src/database/ --include="*.ts" | grep -v "yaml-loader\|config"
```
Expected: **출력 없음** (yaml-loader.ts 외에 잔재 없음)

**Step 3: 캐시 공유 확인 (선택)**

`schema-loader.ts`와 `comment-generator.ts`가 동일 객체를 공유하는지 `console.log` 없이 로직상 검증:
- `loadYaml('schemas/postgresql.yaml')` 캐시 키가 두 곳에서 동일 → 1회 파싱 보장됨

**Step 4: 최종 커밋 (필요시)**

```bash
git log --oneline -5
```

---

## 변경 요약

| 파일 | 변경 유형 | 핵심 내용 |
|------|-----------|-----------|
| `src/database/yaml-loader.ts` | **신규** | `loadYaml<T>()`, `clearYamlCache()` |
| `src/database/schema-loader.ts` | 수정 | 4개 import 제거, `loadQueries()` 1줄 |
| `src/database/metadata/query-loader.ts` | 수정 | 5개 import + `getQueryFilePath()` 제거 |
| `src/database/comment-generator.ts` | 수정 | 4개 import + `_commentSQLCache` 제거 |
| `tests/unit/yaml-loader.test.ts` | **신규** | 캐시 동작 5개 테스트 |
