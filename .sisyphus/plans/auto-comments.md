# Auto-Generate Table/Column Comments MCP Tool

## TL;DR

> **Quick Summary**: AI 기반으로 미설정된 테이블/컬럼 코멘트를 자동 추론하고 DB에 적용하는 MCP 도구를 추가합니다. preview/apply 2단계 모드로 안전하게 운영하며, PostgreSQL/MySQL/Oracle 3개 DBMS를 지원합니다.
>
> **Deliverables**:
>
> - `src/mcp/tools/auto-comments.ts` — MCP 도구 정의 (Zod 스키마 + 핸들러)
> - `src/database/comment-generator.ts` — 코어 로직 (코멘트 추론, SQL 생성, 적용)
> - `src/mcp/utils/config-helper.ts` — 공유 유틸리티 (buildConfigFromEntry 추출)
> - AIProvider 인터페이스에 `generate()` 범용 메서드 추가 (3개 provider 파일)
> - `src/mcp/server.ts` — 도구 등록
> - `tests/unit/comment-generator.test.ts` — Jest 유닛 테스트
> - README.md, .claude/rules/mcp.md 업데이트
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 3 → Task 5 → Task 7 → Task 8

---

## Context

### Original Request

MCP 서버에 테이블/컬럼의 미설정 코멘트를 자동으로 생성하는 기능 추가. 물리명 + 메타데이터 기반 AI 추론 후 COMMENT ON SQL 실행. Oracle 캐릭터셋 설정 시 UTL_RAW 함수 활용.

### Interview Summary

**Key Discussions**:

- preview/apply 2단계 모드 (infer-relationships 패턴 차용)
- 미설정(NULL/빈값) 코멘트만 대상, 기존 코멘트는 절대 덮어쓰지 않음
- AI 컨텍스트: 물리명 + 데이터타입 + PK/FK + 메타데이터(용어집, 네이밍 컨벤션)
- Jest 유닛 테스트 포함 (tests-after)

**Research Findings**:

- MySQL은 `COMMENT ON COLUMN` 구문 없음 → `ALTER TABLE MODIFY COLUMN` + 전체 컬럼 정의 필요
- AIProvider 인터페이스에 범용 메서드 필요 (기존 메서드는 hardcoded system prompt)
- Oracle `COMMENT ON ... IS` 값에 UTL_RAW 표현식 사용 불가 → PL/SQL `EXECUTE IMMEDIATE` 필요
- PostgreSQL은 트랜잭션 지원, MySQL/Oracle은 DDL 자동 커밋
- `buildConfigFromEntry()`가 nl2sql-query.ts에 private → 공유 유틸리티로 추출 필요

### Metis Review

**Identified Gaps** (addressed):

- MySQL ALTER TABLE MODIFY 시 컬럼 정의 완전 복원 필수 (INFORMATION_SCHEMA.COLUMNS 활용)
- 코멘트 길이 제한: MySQL 테이블 2048/컬럼 1024자, Oracle 4000바이트
- 대규모 스키마 배칭 필요 (5-10 테이블/AI 호출)
- AI 응답 JSON 파싱 실패 시 graceful degradation 필요
- 시스템/메타데이터 테이블 제외 필요 (nl2sql 관련 테이블 등)

---

## Work Objectives

### Core Objective

미설정된 테이블/컬럼 코멘트를 AI로 자동 추론하여 COMMENT ON SQL로 적용하는 MCP 도구를 구현합니다.

### Concrete Deliverables

- MCP 도구 `auto_generate_comments` (preview/apply 모드)
- 3개 DBMS별 올바른 COMMENT SQL 생성 (PostgreSQL/MySQL/Oracle)
- Oracle 한글 코멘트 charset 처리
- Jest 유닛 테스트

### Definition of Done

- [ ] `npm run build` → 성공 (TypeScript 에러 없음)
- [ ] `npm run lint` → 성공 (ESLint 위반 없음)
- [ ] `npm test` → 모든 기존 + 신규 테스트 통과
- [ ] MCP 도구 `auto_generate_comments` preview 모드: 코멘트 후보 반환
- [ ] MCP 도구 `auto_generate_comments` apply 모드: DB에 COMMENT SQL 실행

### Must Have

- preview/apply 2단계 모드
- 미설정(NULL/빈값) 코멘트만 대상
- PostgreSQL, MySQL, Oracle 3개 DBMS 지원
- Oracle oracleDataCharset 설정 시 UTL_RAW 기반 한글 처리
- AI 응답 JSON 파싱 실패 시 graceful skip
- 코멘트 값은 반드시 parameterized binding 사용 (SQL injection 방지)
- 코멘트 길이 DBMS별 제한 적용 (MySQL column: 1024, MySQL table: 2048, Oracle: 4000 bytes)
- 시스템/메타데이터 테이블 제외 (excludeSchemas 활용)
- 배칭: 5-10 테이블 단위 AI 호출

### Must NOT Have (Guardrails)

- CLI 커맨드 추가 금지 (MCP 도구만)
- 기존 코멘트 덮어쓰기 금지
- AI 프롬프트에 샘플 데이터 포함 금지 (프라이버시)
- 코멘트 품질 점수/신뢰도 스코어링 금지
- 개별 코멘트 승인 워크플로우 금지
- 코멘트 템플릿 시스템 금지
- 다국어 i18n 프레임워크 금지

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (Jest)
- **Automated tests**: Tests-after
- **Framework**: Jest (ts-jest)

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (npx jest / npm run build / npm run lint) — Run tests, compare output
- **API/Backend**: Use Bash — Import module, call functions, verify output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation):
├── Task 1: Extract buildConfigFromEntry() shared utility [quick]
├── Task 2: Add generate() method to AIProvider interface + 3 providers [quick]
└── Task 3: Core comment generator — schema filtering + AI prompt + response parsing [deep]

Wave 2 (After Wave 1 — DBMS-specific + MCP wiring):
├── Task 4: DBMS-specific SQL builders (PostgreSQL, MySQL, Oracle) [deep]
├── Task 5: MCP tool definition + server registration [unspecified-high]
└── Task 6: Text formatter for preview output [quick]

Wave 3 (After Wave 2 — verification):
├── Task 7: Jest unit tests [unspecified-high]
├── Task 8: Build + lint + full test pass [quick]
└── Task 9: README.md + mcp.md documentation update [writing]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1,2 → Task 3 → Task 4,5 → Task 7 → Task 8
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
| ---- | ---------- | ------ | ---- |
| 1    | —          | 5      | 1    |
| 2    | —          | 3      | 1    |
| 3    | 2          | 4, 5   | 1    |
| 4    | 3          | 5, 7   | 2    |
| 5    | 1, 3, 4, 6 | 7, 8   | 2    |
| 6    | 3          | 5      | 2    |
| 7    | 4, 5       | 8      | 3    |
| 8    | 7          | F1-F4  | 3    |
| 9    | 5          | F1     | 3    |

### Agent Dispatch Summary

- **Wave 1**: 3 — T1 → `quick`, T2 → `quick`, T3 → `deep`
- **Wave 2**: 3 — T4 → `deep`, T5 → `unspecified-high`, T6 → `quick`
- **Wave 3**: 3 — T7 → `unspecified-high`, T8 → `quick`, T9 → `writing`
- **FINAL**: 4 — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Extract `buildConfigFromEntry()` to shared utility

  **What to do**:
  - `src/mcp/tools/nl2sql-query.ts`에서 `buildConfigFromEntry()` 함수(약 lines 65-89)를 `src/mcp/utils/config-helper.ts`로 추출
  - `nl2sql-query.ts`와 `nl2sql-schema.ts`에서 추출된 유틸리티를 import하도록 변경
  - 기존 동작 보존 확인

  **Must NOT do**:
  - 함수 시그니처 변경 금지
  - 새로운 기능 추가 금지 (순수 추출)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 단순 코드 이동 + import 변경. 로직 변경 없음
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: [Task 5]
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/mcp/tools/nl2sql-query.ts:65-89` — 추출 대상 `buildConfigFromEntry()` 함수. ConnectionEntry에서 Config 객체를 구성하는 로직
  - `src/mcp/tools/nl2sql-schema.ts` — 동일 함수를 사용하는 두 번째 파일. import 변경 필요

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: buildConfigFromEntry 추출 후 빌드 성공
    Tool: Bash
    Preconditions: 코드 변경 완료
    Steps:
      1. npm run build 실행
      2. exit code 확인
    Expected Result: exit code 0, TypeScript 컴파일 에러 없음
    Evidence: .sisyphus/evidence/task-1-build.txt

  Scenario: 추출된 함수가 올바르게 import됨
    Tool: Bash (grep)
    Preconditions: 코드 변경 완료
    Steps:
      1. grep -r "buildConfigFromEntry" src/mcp/ 실행
      2. nl2sql-query.ts와 nl2sql-schema.ts에서 config-helper.ts로부터 import 확인
      3. config-helper.ts에서 export 확인
    Expected Result: 3개 파일에서 참조 확인. nl2sql-query.ts에 함수 정의 없음
    Evidence: .sisyphus/evidence/task-1-import-check.txt
  ```

  **Commit**: YES
  - Message: `refactor(mcp): extract buildConfigFromEntry to shared utility`
  - Files: `src/mcp/utils/config-helper.ts`, `src/mcp/tools/nl2sql-query.ts`, `src/mcp/tools/nl2sql-schema.ts`
  - Pre-commit: `npm run build`

- [x] 2. Add generic `generate()` method to AIProvider interface

  **What to do**:
  - `src/ai/providers/openai.ts`의 `AIProvider` 인터페이스에 `generate(systemPrompt: string, userPrompt: string): Promise<string>` 메서드 추가
  - `OpenAIProvider`, `AnthropicProvider`, `DevX` 3개 클래스에 구현 추가
  - 기존 `generateSQL()`, `selectTables()` 메서드는 그대로 유지 (하위 호환)
  - `generate()` 메서드는 system prompt와 user prompt를 받아 AI 응답 텍스트를 반환하는 범용 메서드

  **Must NOT do**:
  - 기존 `generateSQL()`, `selectTables()` 메서드 수정 금지
  - temperature, max_tokens 등 하드코딩 값은 기존 메서드와 동일하게 사용 (temperature: 0, max_tokens: 2048)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 3개 파일에 동일한 패턴의 메서드 추가. 기존 메서드 복제 수준
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: [Task 3]
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/ai/providers/openai.ts:3-6` — AIProvider 인터페이스 정의 (generateSQL, selectTables)
  - `src/ai/providers/openai.ts:17-36` — OpenAIProvider.generateSQL() 구현 패턴. 동일 패턴으로 generate() 구현
  - `src/ai/providers/anthropic.ts` — AnthropicProvider 구현. Anthropic SDK의 messages.create() 패턴
  - `src/ai/providers/devx.ts` — DevX provider 구현

  **API/Type References**:
  - `src/ai/client-factory.ts:6-27` — createAIClient() 팩토리. AIProvider 타입 재export

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: AIProvider 인터페이스에 generate 메서드 존재
    Tool: Bash (grep)
    Preconditions: 코드 변경 완료
    Steps:
      1. grep "generate(" src/ai/providers/openai.ts 실행
      2. AIProvider 인터페이스에 generate 메서드 선언 확인
      3. OpenAIProvider 클래스에 generate 메서드 구현 확인
    Expected Result: 인터페이스 선언 + 구현 모두 존재
    Evidence: .sisyphus/evidence/task-2-interface-check.txt

  Scenario: 3개 provider 모두 generate 메서드 구현
    Tool: Bash (grep)
    Preconditions: 코드 변경 완료
    Steps:
      1. grep -l "async generate(" src/ai/providers/*.ts 실행
      2. openai.ts, anthropic.ts, devx.ts 3개 파일 모두 매칭 확인
    Expected Result: 3개 파일 모두 매칭
    Evidence: .sisyphus/evidence/task-2-providers-check.txt

  Scenario: 빌드 성공
    Tool: Bash
    Steps:
      1. npm run build 실행
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-2-build.txt
  ```

  **Commit**: YES
  - Message: `feat(ai): add generic generate() method to AIProvider interface`
  - Files: `src/ai/providers/openai.ts`, `src/ai/providers/anthropic.ts`, `src/ai/providers/devx.ts`
  - Pre-commit: `npm run build`

- [ ] 3. Core comment generator — schema filtering + AI prompt + response parsing

  **What to do**:
  - `src/database/comment-generator.ts` 신규 파일 생성
  - **스키마 필터링**: 기존 schema 추출 결과에서 comment가 NULL/빈값인 테이블/컬럼만 추출하는 함수
    - `filterMissingComments(schema: SchemaInfo): MissingCommentTarget[]`
    - 시스템 테이블 및 nl2sql 메타데이터 테이블 제외 (excludeSchemas + 하드코딩된 메타테이블 목록)
    - 선택적 schema/tables 필터 적용
  - **AI 프롬프트 빌더**: 미설정 코멘트 대상에 대해 AI에게 코멘트를 요청하는 프롬프트 구성
    - `buildCommentPrompt(targets: MissingCommentTarget[], metadata: MetadataCache | null, dbType: DatabaseType): string`
    - 물리명 + 데이터타입 + PK/FK + 용어집 + 네이밍 컨벤션 컨텍스트 포함
    - AI 응답 형식: JSON `[{schema, table, column?, comment}]`
    - 5-10 테이블 단위 배칭 함수
  - **AI 응답 파서**: JSON 파싱 + 유효성 검증
    - `parseCommentResponse(response: string): GeneratedComment[]`
    - malformed JSON graceful skip (개별 항목)
  - **코멘트 길이 제한**: DBMS별 트렁케이션
    - `truncateComment(comment: string, dbType: DatabaseType, isTable: boolean): { text: string, truncated: boolean }`
  - **타입 정의**:
    - `MissingCommentTarget` — { schema, table, column?, dataType?, isPrimaryKey?, foreignKey? }
    - `GeneratedComment` — { schema, table, column?, comment }
    - `CommentCandidate` — { ...GeneratedComment, truncated?: boolean }
    - `AutoCommentResult` — { candidates, applied?, skipped?, failed? }

  **Must NOT do**:
  - DBMS별 SQL 생성은 이 태스크에 포함하지 않음 (Task 4에서 처리)
  - 샘플 데이터를 AI 프롬프트에 포함하지 않음
  - 기존 코멘트가 있는 테이블/컬럼 포함 금지

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 핵심 비즈니스 로직. AI 프롬프트 설계, JSON 파싱, 배칭 전략 등 복잡한 로직
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Task 2 완료 후)
  - **Parallel Group**: Wave 1 (Task 2 이후 시작)
  - **Blocks**: [Tasks 4, 5, 6]
  - **Blocked By**: [Task 2]

  **References**:

  **Pattern References**:
  - `src/database/metadata/relationship-inference.ts:1-50` — 유사한 코어 로직 파일 구조 (타입 정의 + 추론 함수 + 적용 함수 패턴)
  - `src/database/metadata/relationship-inference.ts:580-646` — inferRelationships() 함수. 배칭 패턴 참고
  - `src/ai/prompt-builder.ts:148-258` — formatMetadataForPrompt() 함수. 메타데이터를 AI 프롬프트로 변환하는 패턴
  - `src/ai/prompt-builder.ts:410-434` — parseSelectedTables() 함수. AI JSON 응답 파싱 패턴 (markdown code block 제거, JSON 추출)

  **API/Type References**:
  - `src/database/schema-extractor.ts` — SchemaInfo, TableInfo, ExtendedColumnInfo 타입 정의
  - `src/database/metadata/types.ts` — MetadataCache, GlossaryTerm, NamingConvention 타입
  - `src/database/types.ts` — DatabaseType ('postgresql' | 'mysql' | 'oracle')

  **External References**:
  - AI 프롬프트에서 JSON 배열 반환 요청 시, system prompt에 "Return ONLY valid JSON array" 패턴 사용 (selectTables 참고)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 미설정 코멘트 필터링 정확성
    Tool: Bash (node REPL)
    Preconditions: comment-generator.ts 구현 완료
    Steps:
      1. npx tsx -e "import { filterMissingComments } from './src/database/comment-generator.js'; ..." 실행
      2. comment가 NULL인 테이블만 포함되는지 확인
      3. comment가 '기존 코멘트'인 테이블은 제외되는지 확인
    Expected Result: NULL/빈값 코멘트만 포함된 배열 반환
    Evidence: .sisyphus/evidence/task-3-filter.txt

  Scenario: AI 프롬프트에 필수 컨텍스트 포함
    Tool: Bash (grep)
    Preconditions: 구현 완료
    Steps:
      1. buildCommentPrompt 함수의 출력 확인
      2. 물리명, 데이터타입, PK/FK 정보가 프롬프트에 포함되는지 확인
    Expected Result: 프롬프트에 테이블명, 컬럼명, 데이터타입, PK/FK 정보 포함
    Evidence: .sisyphus/evidence/task-3-prompt.txt

  Scenario: malformed JSON 응답 graceful handling
    Tool: Bash (node REPL)
    Steps:
      1. parseCommentResponse('invalid json') 호출
      2. parseCommentResponse('[{"table":"t1"}]') 호출 (column 누락)
    Expected Result: invalid json → 빈 배열 반환, 불완전 항목은 skip
    Evidence: .sisyphus/evidence/task-3-parse-error.txt

  Scenario: 빌드 성공
    Tool: Bash
    Steps:
      1. npm run build 실행
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-3-build.txt
  ```

  **Commit**: YES
  - Message: `feat(database): add comment generator core logic`
  - Files: `src/database/comment-generator.ts`
  - Pre-commit: `npm run build`

- [ ] 4. DBMS-specific SQL builders (PostgreSQL, MySQL, Oracle)

  **What to do**:
  - `src/database/comment-generator.ts`에 DBMS별 COMMENT SQL 생성 함수 추가
  - **공통 인터페이스**:
    - `buildCommentSQL(candidate: CommentCandidate, dbType: DatabaseType, oracleDataCharset?: string): { sql: string, bindings: unknown[] }`
    - `applyComments(knex: Knex, dbType: DatabaseType, candidates: CommentCandidate[], oracleDataCharset?: string): Promise<{ applied: number, skipped: number, failed: number }>`
  - **PostgreSQL**:
    - 테이블: `COMMENT ON TABLE "schema"."table" IS ?` (parameterized binding)
    - 컬럼: `COMMENT ON COLUMN "schema"."table"."column" IS ?`
    - apply 시 `BEGIN`/`COMMIT` 트랜잭션으로 감싸기. 에러 시 `ROLLBACK`
  - **MySQL**:
    - 테이블: `ALTER TABLE \`schema\`.\`table\` COMMENT = ?` (parameterized binding)
    - 컬럼: `ALTER TABLE \`schema\`.\`table\` MODIFY COLUMN \`column\` <COLUMN_TYPE> <NULLABLE> <DEFAULT> <EXTRA> COMMENT ?`
    - 컬럼 정의 복원을 위해 INFORMATION_SCHEMA.COLUMNS 조회 함수 필요:
      - `getColumnDefinition(knex: Knex, schema: string, table: string, column: string): Promise<MySQLColumnDef>`
      - COLUMN_TYPE (e.g. varchar(255)), IS_NULLABLE, COLUMN_DEFAULT, EXTRA (e.g. auto_increment) 사용
    - 각 ALTER TABLE은 implicit commit이므로 개별 실행 + 실패 추적
  - **Oracle**:
    - 테이블: `COMMENT ON TABLE "SCHEMA"."TABLE" IS ?` (parameterized binding)
    - 컬럼: `COMMENT ON COLUMN "SCHEMA"."TABLE"."COLUMN" IS ?`
    - **charset 처리**: oracleDataCharset 설정 시:
      - `encodeForOracle(comment, charset)` → hex 문자열
      - PL/SQL 블록: `BEGIN EXECUTE IMMEDIATE 'COMMENT ON TABLE "S"."T" IS ''' || UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(:hex)) || ''''; END;`
      - `relationship-inference.ts:175-186`의 `buildDescriptionBind()` 패턴 참고
    - 각 COMMENT ON은 auto-commit이므로 개별 실행 + 실패 추적
  - **식별자 이스케이핑**: 테이블/컬럼명에 특수문자나 예약어 포함 시 안전하게 처리
    - PostgreSQL: `"identifier"` (double quote)
    - MySQL: `` `identifier` `` (backtick)
    - Oracle: `"IDENTIFIER"` (double quote, uppercase)

  **Must NOT do**:
  - 코멘트 값을 SQL 문자열 보간으로 삽입 금지 (반드시 parameterized binding)
  - 기존 코멘트가 있는 대상에 대해 SQL 생성 금지

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: MySQL ALTER TABLE MODIFY 컬럼 정의 복원이 핵심 난이도. Oracle PL/SQL charset 처리도 복잡
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: [Tasks 5, 7]
  - **Blocked By**: [Task 3]

  **References**:

  **Pattern References**:
  - `src/database/metadata/relationship-inference.ts:700-739` — upsertRelationship() 함수. Oracle charset 처리 패턴 (`buildDescriptionBind`, `encodeForOracle`)
  - `src/database/metadata/relationship-inference.ts:165-186` — buildDescriptionBind() 함수. Oracle UTL_RAW placeholder 치환 패턴
  - `src/database/charset-converter.ts:68-72` — encodeForOracle() 함수. UTF-8 → hex 인코딩

  **API/Type References**:
  - MySQL `INFORMATION_SCHEMA.COLUMNS`: COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA 컬럼 활용
  - Oracle `ALL_TAB_COMMENTS`, `ALL_COL_COMMENTS` — 코멘트 조회 뷰 (쓰기는 COMMENT ON DDL)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: PostgreSQL COMMENT ON SQL 생성 정확성
    Tool: Bash (node REPL)
    Preconditions: DBMS SQL builder 구현 완료
    Steps:
      1. buildCommentSQL({schema:'public', table:'users', comment:'사용자 테이블'}, 'postgresql') 호출
      2. SQL 문자열과 bindings 확인
    Expected Result: sql='COMMENT ON TABLE "public"."users" IS ?' bindings=['사용자 테이블']
    Evidence: .sisyphus/evidence/task-4-pg-sql.txt

  Scenario: MySQL 컬럼 COMMENT SQL에 전체 컬럼 정의 포함
    Tool: Bash (node REPL)
    Steps:
      1. MySQL 컬럼용 buildCommentSQL 호출
      2. ALTER TABLE MODIFY COLUMN 형식 확인
      3. COLUMN_TYPE, IS_NULLABLE, DEFAULT, EXTRA 포함 확인
    Expected Result: ALTER TABLE `schema`.`table` MODIFY COLUMN `col` varchar(255) NOT NULL DEFAULT 'val' COMMENT ?
    Evidence: .sisyphus/evidence/task-4-mysql-modify.txt

  Scenario: Oracle charset 설정 시 UTL_RAW 패턴 사용
    Tool: Bash (node REPL)
    Steps:
      1. buildCommentSQL({...comment:'한글코멘트'}, 'oracle', 'ms949') 호출
      2. PL/SQL 블록에 HEXTORAW 포함 확인
    Expected Result: BEGIN EXECUTE IMMEDIATE ... UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(?)) ... END; + hex 바인딩
    Evidence: .sisyphus/evidence/task-4-oracle-charset.txt

  Scenario: Oracle charset 미설정 시 일반 COMMENT ON
    Tool: Bash (node REPL)
    Steps:
      1. buildCommentSQL({...comment:'ascii comment'}, 'oracle') 호출 (charset 없음)
    Expected Result: COMMENT ON TABLE "SCHEMA"."TABLE" IS ? + 일반 문자열 바인딩
    Evidence: .sisyphus/evidence/task-4-oracle-plain.txt

  Scenario: 빌드 성공
    Tool: Bash
    Steps:
      1. npm run build 실행
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-4-build.txt
  ```

  **Commit**: YES (groups with Task 3)
  - Message: `feat(database): add DBMS-specific comment SQL builders`
  - Files: `src/database/comment-generator.ts`
  - Pre-commit: `npm run build`

- [ ] 5. MCP tool definition + server registration

  **What to do**:
  - `src/mcp/tools/auto-comments.ts` 신규 파일 생성
  - **Zod 입력 스키마** (`autoCommentsInputSchema`):
    - `connectionId?: string` — 연결 ID (선택, 기본 연결 사용)
    - `mode: 'preview' | 'apply'` — 미리보기 또는 적용
    - `schema?: string` — 특정 스키마 필터 (선택)
    - `tables?: string[]` — 특정 테이블 목록 필터 (선택)
  - **출력 인터페이스** (`AutoCommentsOutput`):
    - `success: boolean`
    - `message: string`
    - `connectionId?: string`
    - `result?: AutoCommentResult` — { candidates, applied?, skipped?, failed? }
    - `error?: string`
  - **도구 함수** (`autoCommentsTool`):
    - `connManager.resolve(connectionId)` → entry 조회
    - `buildConfigFromEntry(entry)` (Task 1에서 추출한 유틸리티) → Config 생성 → `createAIClient(config)` → AIProvider
    - `connManager.getOrInitCache(entry.connectionId)` → 메타데이터 캐시
    - 스키마 추출: `NL2SQLEngine.getSchema()` 또는 직접 `extractSchema()`
    - `filterMissingComments()` → 대상 추출
    - preview 모드: AI 코멘트 생성 → candidates 반환 (DB 쓰기 없음)
    - apply 모드: AI 코멘트 생성 → `applyComments()` → 결과 반환
    - apply 후 `connManager.invalidateCache(entry.connectionId)` 호출
    - 에러 핸들링: `maskSensitiveInfo()`
  - `src/mcp/server.ts`에 도구 등록:
    - 도구명: `auto_generate_comments`
    - infer_relationships 다음(8단계 위치)에 등록
    - `formatAutoCommentResult()` (Task 6)로 텍스트 포맷팅

  **Must NOT do**:
  - CLI 커맨드 추가 금지
  - 기존 도구 순서/동작 변경 금지

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: MCP 도구 정의 + 서버 등록 + 여러 모듈 통합. infer-relationships 패턴 정확히 따라야 함
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (Task 4, 6 완료 후)
  - **Blocks**: [Tasks 7, 8]
  - **Blocked By**: [Tasks 1, 3, 4, 6]

  **References**:

  **Pattern References**:
  - `src/mcp/tools/infer-relationships.ts:26-161` — 전체 파일이 참조. Zod 스키마 + 출력 인터페이스 + preview/apply 분기 + 에러 핸들링 패턴을 거의 동일하게 따름
  - `src/mcp/server.ts:195-230` — infer_relationships 도구 등록 패턴. formatInferenceResult() + JSON stringify 패턴
  - `src/mcp/tools/nl2sql-query.ts:65-89` — buildConfigFromEntry() 사용 패턴 (Task 1에서 추출 후 import 경로 변경)

  **API/Type References**:
  - `src/mcp/utils/config-helper.ts` — Task 1에서 추출한 buildConfigFromEntry()
  - `src/database/comment-generator.ts` — Task 3, 4에서 구현한 코어 로직
  - `src/ai/client-factory.ts` — createAIClient() 팩토리
  - `src/database/connection-manager.ts:220-225` — resolve() 메서드

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: MCP 도구 등록 확인
    Tool: Bash (grep)
    Preconditions: server.ts 업데이트 완료
    Steps:
      1. grep "auto_generate_comments" src/mcp/server.ts 실행
      2. registerTool 호출 확인
    Expected Result: 'auto_generate_comments' 도구 등록 확인
    Evidence: .sisyphus/evidence/task-5-registration.txt

  Scenario: Zod 스키마 유효성 검증
    Tool: Bash (node REPL)
    Steps:
      1. autoCommentsInputSchema.parse({mode: 'preview'}) → 성공
      2. autoCommentsInputSchema.parse({mode: 'invalid'}) → ZodError
      3. autoCommentsInputSchema.parse({}) → ZodError (mode 필수)
    Expected Result: 유효한 입력 통과, 잘못된 입력 거부
    Evidence: .sisyphus/evidence/task-5-zod-validation.txt

  Scenario: 빌드 성공
    Tool: Bash
    Steps:
      1. npm run build 실행
    Expected Result: exit code 0
    Evidence: .sisyphus/evidence/task-5-build.txt
  ```

  **Commit**: YES
  - Message: `feat(mcp): add auto_generate_comments tool`
  - Files: `src/mcp/tools/auto-comments.ts`, `src/mcp/server.ts`
  - Pre-commit: `npm run build`

- [ ] 6. Text formatter for preview output

  **What to do**:
  - `src/mcp/tools/auto-comments.ts`에 `formatAutoCommentResult()` 함수 추가
  - preview 모드 출력을 human-readable 텍스트로 포맷
  - 테이블 코멘트와 컬럼 코멘트를 그룹별로 분류하여 표시:

    ```
    ## Table Comments (5 candidates)
      SCHEMA.TABLE1 → "추론된 코멘트"
      SCHEMA.TABLE2 → "추론된 코멘트"

    ## Column Comments (12 candidates)
      SCHEMA.TABLE1.COL1 (VARCHAR2) → "추론된 코멘트"
      SCHEMA.TABLE1.COL2 (NUMBER) → "추론된 코멘트" [TRUNCATED]
    ```

  - 트렁케이션된 코멘트에 `[TRUNCATED]` 표시
  - apply 모드 결과: `Applied: N, Skipped: N, Failed: N`

  **Must NOT do**:
  - 복잡한 테이블 렌더링 금지 (단순 텍스트)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 단순 문자열 포맷팅 함수
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: [Task 5]
  - **Blocked By**: [Task 3]

  **References**:

  **Pattern References**:
  - `src/mcp/tools/infer-relationships.ts:166-213` — formatInferenceResult() 함수. 거의 동일한 포맷팅 패턴

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: preview 포맷 출력 확인
    Tool: Bash (node REPL)
    Steps:
      1. formatAutoCommentResult({candidates: [{schema:'public', table:'users', comment:'사용자'}]}) 호출
      2. 출력에 "Table Comments" 섹션 포함 확인
    Expected Result: 그룹별 분류된 텍스트 출력
    Evidence: .sisyphus/evidence/task-6-format.txt
  ```

  **Commit**: YES (groups with Task 5)
  - Message: `feat(mcp): add auto_generate_comments tool`
  - Files: `src/mcp/tools/auto-comments.ts`

- [ ] 7. Jest unit tests

  **What to do**:
  - `tests/unit/comment-generator.test.ts` 신규 파일 생성
  - **테스트 케이스**:
    1. `filterMissingComments()` — NULL/빈값 코멘트만 필터링
    2. `filterMissingComments()` — 시스템 테이블 제외
    3. `filterMissingComments()` — schema/tables 필터 적용
    4. `buildCommentPrompt()` — 물리명, 데이터타입, PK/FK 컨텍스트 포함
    5. `parseCommentResponse()` — 유효한 JSON 파싱
    6. `parseCommentResponse()` — 잘못된 JSON graceful handling
    7. `truncateComment()` — MySQL 1024자 제한
    8. `truncateComment()` — Oracle 4000바이트 제한
    9. `buildCommentSQL()` — PostgreSQL COMMENT ON TABLE
    10. `buildCommentSQL()` — PostgreSQL COMMENT ON COLUMN
    11. `buildCommentSQL()` — MySQL ALTER TABLE COMMENT
    12. `buildCommentSQL()` — MySQL ALTER TABLE MODIFY COLUMN (전체 정의 포함)
    13. `buildCommentSQL()` — Oracle COMMENT ON (charset 미설정)
    14. `buildCommentSQL()` — Oracle COMMENT ON (charset 설정, UTL_RAW)
    15. `formatAutoCommentResult()` — preview 포맷
    16. `formatAutoCommentResult()` — apply 포맷 (applied/skipped/failed)
  - 기존 테스트 패턴 따르기: `describe('moduleName', () => { describe('functionName', () => { it('should ...') }) })`
  - AI 호출은 모킹: `jest.unstable_mockModule()` 패턴 사용

  **Must NOT do**:
  - 실제 DB 연결 테스트 금지 (모킹 사용)
  - 실제 AI API 호출 금지 (모킹 사용)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 16개 테스트 케이스. 모킹 패턴 정확히 따라야 함
  - **Skills**: [`quick-test`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: [Task 8]
  - **Blocked By**: [Tasks 4, 5]

  **References**:

  **Test References**:
  - `tests/unit/relationship-inference.test.ts` — 가장 유사한 기존 테스트. jest.unstable_mockModule() 패턴, Knex 모킹 패턴
  - `tests/unit/prompt-builder.test.ts` — 프롬프트 빌더 테스트 패턴
  - `tests/unit/response-parser.test.ts` — JSON 파싱 테스트 패턴

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 신규 테스트 전체 통과
    Tool: Bash
    Steps:
      1. npx jest tests/unit/comment-generator.test.ts --verbose 실행
    Expected Result: 16개 테스트 모두 PASS
    Evidence: .sisyphus/evidence/task-7-tests.txt

  Scenario: 기존 테스트 regression 없음
    Tool: Bash
    Steps:
      1. npm test 실행
    Expected Result: 모든 기존 테스트 PASS
    Evidence: .sisyphus/evidence/task-7-full-tests.txt
  ```

  **Commit**: YES
  - Message: `test(comment-generator): add unit tests for auto-comment generation`
  - Files: `tests/unit/comment-generator.test.ts`
  - Pre-commit: `npm test`

- [ ] 8. Build + lint + full test pass

  **What to do**:
  - 전체 빌드, 린트, 테스트 통과 확인
  - 발견된 에러 수정

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Blocked By**: [Task 7]

  **Acceptance Criteria**:

  ```
  Scenario: 전체 빌드 + 린트 + 테스트 통과
    Tool: Bash
    Steps:
      1. npm run build → exit 0
      2. npm run lint → exit 0
      3. npm test → all pass
    Expected Result: 모두 성공
    Evidence: .sisyphus/evidence/task-8-final-check.txt
  ```

  **Commit**: NO (필요 시 fix 커밋)

- [ ] 9. README.md + mcp.md documentation update

  **What to do**:
  - `README.md`의 MCP 도구 테이블에 `auto_generate_comments` 추가
  - `.claude/rules/mcp.md`에 도구 설명 추가
  - 사용 예시 포함

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3)
  - **Blocked By**: [Task 5]

  **Acceptance Criteria**:

  ```
  Scenario: README에 도구 문서 포함
    Tool: Bash (grep)
    Steps:
      1. grep "auto_generate_comments" README.md
    Expected Result: 도구명 포함 확인
    Evidence: .sisyphus/evidence/task-9-readme.txt
  ```

  **Commit**: YES
  - Message: `docs: add auto_generate_comments tool documentation`
  - Files: `README.md`, `.claude/rules/mcp.md`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `tsc --noEmit` + linter + `npm test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
      Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
      Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
      Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(ai): add generic generate() method to AIProvider interface` — providers/openai.ts, providers/anthropic.ts, providers/devx.ts
- **Wave 1**: `refactor(mcp): extract buildConfigFromEntry to shared utility` — mcp/utils/config-helper.ts, mcp/tools/nl2sql-query.ts, mcp/tools/nl2sql-schema.ts
- **Wave 1-2**: `feat(database): add comment generator core logic` — database/comment-generator.ts
- **Wave 2**: `feat(mcp): add auto_generate_comments tool` — mcp/tools/auto-comments.ts, mcp/server.ts
- **Wave 3**: `test(comment-generator): add unit tests` — tests/unit/comment-generator.test.ts
- **Wave 3**: `docs: add auto_generate_comments tool documentation` — README.md, .claude/rules/mcp.md

---

## Success Criteria

### Verification Commands

```bash
npm run build        # Expected: exit 0
npm run lint         # Expected: exit 0
npm test             # Expected: all tests pass
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] MCP tool registered and callable
- [ ] 3 DBMS comment SQL generation correct
- [ ] Oracle charset handling verified
