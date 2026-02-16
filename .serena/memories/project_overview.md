# NL2SQL Project Overview

## Purpose
자연어를 SQL로 변환하는 CLI 도구 및 MCP(Model Context Protocol) 서버.
사용자가 자연어로 질문하면 AI가 적절한 SQL을 생성하고 선택적으로 실행한다.

## Tech Stack
- **Language**: TypeScript (ESM modules, `.js` 확장자 필수)
- **Runtime**: Node.js 20+
- **Build**: tsc (TypeScript compiler)
- **Test**: Jest
- **Lint**: ESLint + Prettier
- **DB**: Knex.js (PostgreSQL, MySQL, Oracle 지원)
- **AI**: OpenAI, Anthropic, DevX providers
- **Protocol**: MCP SDK (@modelcontextprotocol/sdk)
- **Config**: Zod schema validation
- **Container**: Docker + docker-compose

## Architecture Layers

### 1. CLI Layer (`src/cli/`)
- Commander.js 기반 CLI (`src/index.ts`)
- Commands: query, schema
- Interactive REPL mode (`InteractiveSession` class)
- Result formatters (table/json/csv)

### 2. Core Layer (`src/core/`)
- `NL2SQLEngine` class: 핵심 엔진
  - `process()`: 자연어 → SQL 변환 + 선택적 실행
  - `generateSQL()`: AI로 SQL 생성
  - `executeSQL()`: SQL 실행
  - `getSchema()`: DB 스키마 추출

### 3. AI Layer (`src/ai/`)
- `createAIClient()`: provider별 팩토리
- `buildPrompt()`: 메타데이터 포함 프롬프트 빌드
- Providers: OpenAI, Anthropic, DevX

### 4. Database Layer (`src/database/`)
- `ConnectionManager`: 다중 연결 관리 (풀링, idle TTL, 자동 정리)
- Adapters: PostgreSQL, MySQL, Oracle 스키마 추출
- Schema loader: YAML 기반 DB별 쿼리 정의
- Charset converter: Oracle US7ASCII 한글 처리
- **Metadata subsystem** (`src/database/metadata/`):
  - `cache.ts`: 메타데이터 캐시 (관계, 네이밍 컨벤션, 공통코드, 용어집, 쿼리패턴)
  - `relationship-inference.ts`: FK 관계 자동 추론 (네이밍 패턴 + 컬럼명 매칭)
  - `schema-setup.ts`: 메타데이터 스키마 설치

### 5. MCP Layer (`src/mcp/`)
- `createMcpServer()`: MCP 서버 생성 + 10개 도구 등록
- Tools: db_test_connection, db_connect, db_disconnect, db_list_connections, nl2sql_schema, nl2sql_query, cache_status, cache_refresh, schema_setup, infer_relationships
- Transport: stdio (Claude Desktop) / SSE (HTTP + Bearer auth)

### 6. Cross-cutting
- `src/config/`: Zod 스키마 기반 설정 (env > config file > defaults)
- `src/errors/`: 커스텀 에러 계층 (NL2SQLError base)
- `src/logger/`: 로깅 시스템
- `src/utils/`: 입력 검증 (SQL 인젝션 방지)

## SQL Metadata Schema
- `sql/{postgresql,mysql,oracle}/` 디렉토리에 DDL 파일
- `00_create_schema.sql` ~ `10_auto_import.sql`
- 메타데이터 테이블: relationships, naming_conventions, code_tables, glossary, query_patterns
