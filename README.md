# NL2SQL CLI Tool

자연어를 SQL로 변환하는 TypeScript CLI 도구

## Features

- **AI Engine**: OpenAI GPT 또는 Anthropic Claude 지원 (환경변수로 전환)
- **Database**: PostgreSQL, MySQL, Oracle 직접 연결 및 스키마 자동 추출
- **Security**: SQL 인젝션 방지, 프롬프트 인젝션 감지, 민감 정보 마스킹
- **Output**: Table, JSON, CSV 다양한 출력 형식 지원
- **CLI**: 간단한 명령어로 SQL 생성 및 실행

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

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `query <text>` | `q` | Generate SQL from natural language |
| `schema` | `s` | Display database schema |

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
│   │   └── formatters/
│   │       └── result-formatter.ts # Output formatters (table/json/csv)
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
│   │   ├── schema-extractor.ts     # Schema extraction
│   │   ├── schema-loader.ts        # Schema loading utilities
│   │   ├── types.ts                # Type definitions
│   │   └── adapters/
│   │       ├── postgresql.ts
│   │       ├── mysql.ts
│   │       └── oracle.ts
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
| Database | Knex.js, pg, mysql2, oracledb |
| CLI | Commander.js, Inquirer.js |
| UI | Chalk, Ora |
| Validation | Zod |
| Testing | Jest, ts-jest |
| Linting | ESLint, Prettier |

## License

MIT
