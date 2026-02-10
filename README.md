# NL2SQL CLI Tool

자연어를 SQL로 변환하는 TypeScript CLI 도구

## Features

- **AI Engine**: OpenAI GPT 또는 Anthropic Claude 지원 (환경변수로 전환)
- **Database**: PostgreSQL, MySQL, Oracle 직접 연결 및 스키마 자동 추출
- **Security**: SQL 인젝션 방지, 프롬프트 인젝션 감지, 민감 정보 마스킹
- **Output**: Table, JSON, CSV 다양한 출력 형식 지원
- **CLI**: 간단한 명령어로 SQL 생성 및 실행
- **Interactive REPL**: 대화형 모드로 연속 쿼리 실행
- **Metadata Auto-Setup**: 메타데이터 테이블 자동 생성 (CLI/MCP)
- **MCP Server**: Model Context Protocol 지원 (stdio/SSE), 다중 연결 관리
- **Docker**: 컨테이너 배포 지원

## Installation

```bash
npm install
npm run build
```

## Configuration

### Environment Variables

`.env.example`을 복사하여 `.env` 파일을 생성하고 설정값을 입력합니다:

```bash
cp .env.example .env
```

```bash
# AI Configuration
NL2SQL_AI_PROVIDER=openai  # Options: openai, anthropic
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
NL2SQL_MODEL=gpt-4         # Optional: 사용할 모델 지정

# Database Configuration
DB_TYPE=postgresql         # Options: postgresql, mysql, oracle
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=mydb
DB_SERVICE_NAME=           # Oracle only

# Logging (optional)
LOG_LEVEL=info             # Options: debug, info, warn, error, silent
LOG_FORMAT=text            # Options: text, json
NODE_ENV=development       # Options: development, production
```

### Configuration File (Optional)

환경변수 대신 설정 파일을 사용할 수 있습니다. 프로젝트 루트에 `nl2sql.config.json` 또는 `nl2sql.config.yaml` 파일을 생성합니다:

**nl2sql.config.json:**
```json
{
  "ai": {
    "provider": "openai",
    "model": "gpt-4"
  },
  "database": {
    "type": "postgresql",
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "password",
    "database": "mydb"
  },
  "logging": {
    "level": "info"
  }
}
```

**설정 우선순위:** CLI 옵션 > 환경변수 > 설정파일 > 기본값

## Usage

### Generate SQL from Natural Language

```bash
# Basic usage
npm start -- "고객의 VIP등급을 조회하는 쿼리를 만들어줘"

# Or using the query command
npm start -- query "List all customers with their orders"

# Generate and execute
npm start -- query "Show top 10 products by sales" --execute

# Skip confirmation prompt
npm start -- query "Count all users" --execute --yes

# Output format options
npm start -- query "사용자 목록" --execute --format json
npm start -- query "사용자 목록" --execute --format csv
```

### View Database Schema

```bash
# Table format (default)
npm start -- schema

# JSON format
npm start -- schema --format json

# Prompt format (for debugging AI prompts)
npm start -- schema --format prompt
```

### Setup Metadata Tables

연결된 데이터베이스의 기본 스키마에 NL2SQL 메타데이터 테이블(11개)을 자동 생성합니다.
기존 테이블은 건너뛰므로 멱등(idempotent)하게 실행할 수 있습니다.

```bash
# 확인 프롬프트 후 생성
npm start -- setup

# 확인 없이 바로 생성
npm start -- setup -y
```

### Interactive REPL Mode

대화형 모드로 연속적인 자연어 쿼리를 실행합니다.

```bash
# 기본 모드
npm start -- interactive

# 자동 실행 모드
npm start -- interactive --auto-execute

# JSON 출력 형식
npm start -- interactive --format json
```

REPL 내부 명령어:
- `.help` - 도움말
- `.schema [table]` - 스키마 조회
- `.format [type]` - 출력 형식 변경 (table/json/csv)
- `.execute` - 자동 실행 모드 토글
- `.cache` - 메타데이터 캐시 상태
- `.exit` - 종료

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `query <text>` | `q` | Generate SQL from natural language |
| `schema` | `s` | Display database schema |
| `setup` | - | Create metadata tables automatically |
| `interactive` | `i` | Start interactive REPL mode |

### Options

| Option | Description |
|--------|-------------|
| `-e, --execute` | Execute the generated SQL query |
| `-y, --yes` | Skip confirmation prompt when executing |
| `-f, --format <format>` | Output format (table, json, csv, prompt) |

## Example

```bash
$ npm start -- "고객의 VIP등급을 조회하는 쿼리를 만들어줘"

✔ Connected to database: mydb
✔ Schema extracted (12 tables)
✔ SQL generated

Generated SQL:
SELECT customer_id, name, vip_grade
FROM customers
WHERE vip_grade IS NOT NULL;

? Execute this query? (y/N)
```

## Metadata Schema Auto-Setup

NL2SQL은 메타데이터 기반으로 더 정확한 SQL을 생성합니다. `setup` 명령어로 연결된 데이터베이스의 **기본 스키마**에 11개 메타데이터 테이블을 자동 생성할 수 있습니다.

### 메타데이터 테이블

| 테이블 | 설명 |
|--------|------|
| `table_relationships` | 테이블 간 관계 (FK, 조인 힌트) |
| `naming_conventions` | 네이밍 규칙 (약어, 접두사 등) |
| `code_tables` | 공통코드 테이블 정의 |
| `column_code_mapping` | 컬럼-코드 테이블 매핑 |
| `code_aliases` | 코드값 한글/영문 별칭 |
| `glossary_terms` | 비즈니스 용어 사전 |
| `glossary_aliases` | 용어 별칭 |
| `glossary_contexts` | 용어 사용 컨텍스트 |
| `query_patterns` | SQL 쿼리 패턴 |
| `pattern_parameters` | 패턴 파라미터 |
| `pattern_keywords` | 패턴 키워드 매핑 |

### 사용 방법

```bash
# CLI에서 실행
npm start -- setup           # 확인 후 생성
npm start -- setup -y        # 확인 없이 바로 생성

# MCP에서 실행 (schema_setup 도구)
# AI 에이전트가 사용자 확인 후 자동 생성
```

별도의 `nl2sql` 스키마를 생성할 필요 없이, 연결된 데이터베이스의 기본 스키마에 직접 테이블이 생성됩니다. 이미 존재하는 테이블은 건너뛰므로 안전하게 재실행할 수 있습니다.

## Security Features

### SQL Validation
위험한 SQL 패턴을 자동으로 감지하고 차단합니다:
- **차단**: DROP, DELETE, TRUNCATE, ALTER 문
- **감지**: SQL 인젝션 패턴 (UNION SELECT, 주석, 파일 접근 등)
- **허용**: SELECT, INSERT, UPDATE (일반 CRUD 작업)

```bash
# 위험한 쿼리는 자동 차단됨
$ npm start -- query "DROP TABLE users" --execute
# Error: Dangerous keyword detected: DROP
```

### Input Validation
사용자 입력에 대한 보안 검증:
- 최대 입력 길이 제한 (2000자)
- 프롬프트 인젝션 패턴 감지
- 특수 문자 및 제어 문자 정제

### Error Masking
민감한 정보가 에러 메시지에 노출되지 않도록 마스킹:
- API 키 마스킹 (`sk-***`)
- IP 주소 마스킹
- 비밀번호 마스킹

## MCP Server

NL2SQL은 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)을 지원하여 AI 에이전트에게 NL2SQL 기능을 제공합니다.

### MCP 도구

| 도구 | 설명 |
|------|------|
| `db_test_connection` | 환경변수 DB 연결 테스트 (파라미터 없음) |
| `db_connect` | 자격증명으로 DB 연결 (connectionId 반환) |
| `db_disconnect` | 등록된 DB 연결 해제 |
| `db_list_connections` | 활성 DB 연결 목록 조회 |
| `nl2sql_schema` | 스키마 조회 (json/prompt/summary 형식) |
| `nl2sql_query` | 자연어 → SQL 변환 및 선택적 실행 |
| `cache_status` | 메타데이터 캐시 상태 조회 |
| `cache_refresh` | 메타데이터 캐시 새로고침 (Docker 재기동 불필요) |
| `schema_setup` | 메타데이터 테이블 자동 생성 (사용자 확인 필수) |

### stdio 모드 (Claude Desktop 등)

```bash
npm run start:mcp
```

Claude Desktop 설정 (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "nl2sql": {
      "command": "node",
      "args": ["/path/to/nl2sql_ts/dist/mcp/index.js"],
      "env": {
        "DB_TYPE": "postgresql",
        "DB_HOST": "localhost",
        "DB_USER": "postgres",
        "DB_PASSWORD": "password",
        "DB_NAME": "mydb",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### SSE 모드 (HTTP 서버)

```bash
npm run start:mcp:sse
```

환경변수:
- `MCP_TRANSPORT=sse`: SSE 모드 활성화
- `MCP_PORT=3001`: 서버 포트 (기본: 3001)
- `MCP_AUTH_TOKEN`: Bearer 인증 토큰 (선택)

엔드포인트:
- `GET /health`: 헬스체크
- `GET /sse`: SSE 연결
- `POST /message`: 메시지 수신

## Docker

### 빌드 및 실행

```bash
# 이미지 빌드
npm run docker:build

# Docker Compose로 실행
npm run docker:run

# 로그 확인
npm run docker:logs

# 중지
npm run docker:stop
```

### 직접 실행

```bash
docker run -d \
  -p 3001:3001 \
  -e MCP_TRANSPORT=sse \
  -e MCP_AUTH_TOKEN=your-secure-token \
  -e DB_HOST=host.docker.internal \
  -e DB_USER=postgres \
  -e DB_PASSWORD=password \
  -e DB_NAME=mydb \
  -e OPENAI_API_KEY=sk-xxx \
  nl2sql-mcp
```

### Docker에서 로컬 DB 접근

- Mac/Windows: `DB_HOST=host.docker.internal` 사용
- Linux: 호스트 IP 또는 `--network host` 사용

## Development

```bash
# Run in development mode
npm run dev

# Build
npm run build

# Lint
npm run lint
npm run lint:fix

# Format
npm run format
npm run format:check

# Test
npm test
npm run test:watch
npm run test:coverage
```

## Project Structure

```
nl2sql_ts/
├── src/
│   ├── index.ts                    # CLI entry point
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── query.ts            # Query command
│   │   │   └── schema.ts           # Schema command
│   │   ├── formatters/
│   │   │   └── result-formatter.ts # Output formatters (table/json/csv)
│   │   └── modes/
│   │       └── interactive.ts      # Interactive REPL mode
│   ├── mcp/
│   │   ├── index.ts                # MCP server entry point
│   │   ├── server.ts               # MCP server setup & tools
│   │   ├── tools/
│   │   │   ├── db-test.ts          # db_test_connection tool
│   │   │   ├── db-connect.ts       # db_connect tool
│   │   │   ├── db-disconnect.ts    # db_disconnect tool
│   │   │   ├── db-list.ts          # db_list_connections tool
│   │   │   ├── nl2sql-schema.ts    # nl2sql_schema tool
│   │   │   ├── nl2sql-query.ts     # nl2sql_query tool
│   │   │   ├── cache-manage.ts     # cache_status, cache_refresh tools
│   │   │   └── schema-setup.ts     # schema_setup tool
│   │   └── transport/
│   │       └── sse.ts              # SSE transport + auth
│   ├── config/
│   │   └── index.ts                # Configuration loader (env + file)
│   ├── core/
│   │   └── nl2sql-engine.ts        # Main orchestration
│   ├── ai/
│   │   ├── client-factory.ts       # AI client factory
│   │   ├── prompt-builder.ts       # Prompt generation
│   │   ├── response-parser.ts      # SQL parsing & validation
│   │   └── providers/
│   │       ├── openai.ts
│   │       └── anthropic.ts
│   ├── database/
│   │   ├── connection.ts           # DB connection factory
│   │   ├── connection-manager.ts   # Multi-connection manager (MCP)
│   │   ├── schema-extractor.ts     # Schema extraction
│   │   ├── schema-loader.ts        # Schema loading utilities
│   │   ├── types.ts                # Type definitions
│   │   ├── adapters/
│   │   │   ├── postgresql.ts
│   │   │   ├── mysql.ts
│   │   │   └── oracle.ts
│   │   ├── metadata/
│   │   │   ├── index.ts            # Metadata module exports
│   │   │   ├── types.ts            # Metadata type definitions
│   │   │   ├── cache.ts            # Metadata cache system
│   │   │   ├── query-loader.ts     # YAML query loader
│   │   │   └── schema-setup.ts     # Metadata table auto-creation
│   │   └── schemas/metadata/
│   │       ├── postgresql-metadata.yaml  # PostgreSQL queries & DDL
│   │       ├── mysql-metadata.yaml       # MySQL queries & DDL
│   │       └── oracle-metadata.yaml      # Oracle queries & DDL
│   ├── errors/
│   │   └── index.ts                # Custom error classes & masking
│   ├── logger/
│   │   └── index.ts                # Structured logging system
│   └── utils/
│       └── input-validator.ts      # Input validation & sanitization
├── tests/
│   └── unit/
│       ├── config.test.ts
│       ├── errors.test.ts
│       ├── input-validator.test.ts
│       ├── response-parser.test.ts
│       └── result-formatter.test.ts
├── .env.example
├── .eslintrc.json
├── .prettierrc.json
├── .dockerignore
├── Dockerfile                      # Multi-stage Docker build
├── docker-compose.yml              # Docker Compose config
├── jest.config.js
├── package.json
├── tsconfig.json
└── README.md
```

## Tech Stack

| Category | Technology |
|----------|------------|
| Language | TypeScript 5.x |
| Runtime | Node.js (ESM) |
| AI | OpenAI SDK, Anthropic SDK |
| MCP | @modelcontextprotocol/sdk |
| Database | Knex.js, pg, mysql2, oracledb |
| CLI | Commander.js, Inquirer.js |
| UI | Chalk, Ora |
| Validation | Zod |
| Testing | Jest, ts-jest |
| Linting | ESLint, Prettier |
| Container | Docker, Docker Compose |

## License

MIT
