# YAML Loader 통합 설계

**날짜**: 2026-02-21
**범위**: DB 스키마 YAML 로딩 중복 제거 (3개 파일)

## 배경

`schema-loader.ts`, `metadata/query-loader.ts`, `comment-generator.ts` 세 파일이 각각
독립적으로 `readFileSync + yaml.load` 패턴을 구현하고 있으며:

- `schema-loader.ts`와 `comment-generator.ts`는 동일한 `schemas/{db}.yaml` 파일을 별도로 두 번 파싱
- `schema-loader.ts`는 캐시 없음 (인스턴스 생성 시마다 재파싱)
- `query-loader.ts`는 불필요한 3단 폴백 경로 해석 로직을 포함

## 결정 사항

**Option A: 범용 캐시 유틸리티** 채택

신규 파일 `src/database/yaml-loader.ts`를 만들고, 각 소비자가 `loadYaml<T>(relativePath)`를
호출하는 방식으로 통일한다.

## 설계

### 신규 파일: `src/database/yaml-loader.ts`

```typescript
const _dir = dirname(fileURLToPath(import.meta.url)); // dist/database/
const _cache = new Map<string, unknown>();

export function loadYaml<T>(relativePath: string): T
export function clearYamlCache(): void  // 테스트용
```

- 캐시 키: `relativePath` 문자열 (예: `'schemas/postgresql.yaml'`)
- 동일 경로 재요청 시 파싱 완전 생략
- 에러: 원본 Node.js/js-yaml 에러 그대로 전파

### 소비자 파일 변경

| 파일 | 제거 | 변경 |
|------|------|------|
| `schema-loader.ts` | `readFileSync`, `fileURLToPath`, `dirname`, `join`, `yaml` import | `loadQueries()` → 1줄 |
| `metadata/query-loader.ts` | 위 4개 + `existsSync` + `getQueryFilePath()` 함수 전체 | `loadMetadataQueries()` 단순화 |
| `comment-generator.ts` | 위 4개 + `_commentSQLCache` Map | `loadCommentSQL()` 내부 로직 제거 |

### 캐시 공유 효과

`SchemaLoader('postgresql')`과 `loadCommentSQL('postgresql')` 모두
`schemas/postgresql.yaml` 키로 캐시 접근 → 파일 파싱 **1회**로 통일

### 에러 핸들링

`loadYaml` 자체에서 에러 래핑 없음. 파일 없음(`ENOENT`), 파싱 오류 모두 원본 에러 전파.
`query-loader.ts`의 기존 에러 래핑 제거.

## 파일 변경 목록

1. **신규**: `src/database/yaml-loader.ts`
2. **수정**: `src/database/schema-loader.ts`
3. **수정**: `src/database/metadata/query-loader.ts`
4. **수정**: `src/database/comment-generator.ts`
5. **신규**: `tests/unit/yaml-loader.test.ts`

## 제외 범위

`src/config/index.ts`의 yaml 사용 — 사용자 설정 파일(nl2sql.yaml) 로딩으로 다른 책임
