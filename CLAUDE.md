# NL2SQL Project

Natural language to SQL conversion CLI tool and MCP server.

## Commands

```bash
npm run build                                 # TypeScript compile
npm run lint                                  # ESLint check
npm test                                      # Jest test
npm start -- query "natural language" [-e]    # Generate SQL (optionally execute)
npm start -- schema                           # Show schema
npm start -- interactive [--auto-execute]     # Interactive REPL mode
npm run start:mcp                             # MCP stdio mode (for Claude Desktop)
npm run start:mcp:sse                         # MCP SSE HTTP mode
```

## Docker

```bash
npm run docker:build                          # Build image
npm run docker:run                            # Run MCP server
npm run docker:stop                           # Stop
docker-compose --profile cli up -d            # Run Interactive CLI
docker-compose --profile cli exec nl2sql-cli  # Connect to CLI
```

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── cli/commands/         # query, schema commands
├── cli/formatters/       # Output formatters
├── cli/modes/            # Interactive REPL mode
├── config/               # Config loader (Zod schema validation)
├── core/                 # NL2SQL engine
├── ai/providers/         # OpenAI, Anthropic providers
├── database/adapters/    # PostgreSQL, MySQL, Oracle adapters
├── database/metadata/    # Metadata cache system
├── database/schemas/     # DBMS-specific SQL queries (YAML files)
├── errors/               # Custom error classes
├── logger/               # Logging system
├── mcp/                  # MCP server (stdio/SSE)
└── utils/                # Utilities

sql/{postgresql,mysql,oracle}/  # DDL scripts (00_~99_ numbered)
```

## Code Rules (MUST follow)

1. **ESM modules**: Always use `.js` extension in imports
2. **Zod validation**: All config values must be validated with Zod schemas
3. **Error masking**: Never expose sensitive info in production errors
4. **SQL security**: Block dangerous queries (DROP, DELETE, TRUNCATE, ALTER)
5. **Input validation**: Detect prompt injection patterns
6. **Config priority**: CLI options > env vars > config file > defaults

## Operational Guidelines (MUST follow)

1. **Analyze before coding**: Use **Serena MCP** tools to analyze the codebase before making any changes
2. **Update README**: After changes, always update [README.md](README.md)
3. **Update MCP docs**: After changes, always update [.claude/rules/mcp.md](.claude/rules/mcp.md)
4. **SSOT/DRY**: Follow Single Source of Truth and Don't Repeat Yourself. Keep each file under 1500 characters
5. **Oracle Korean charset**: For Oracle with US7ASCII + double-encoding (MS949->latin1), always use `UTL_RAW.CAST_TO_RAW` for Korean text columns
6. **SQL in YAML only**: Never write SQL in TypeScript. All SQL must be in DBMS-specific YAML files (`src/database/schemas/`)

## Key Features

- **Metadata cache**: Caches metadata tables in memory at server start (relationships, naming conventions, code tables, glossary, query patterns)
- **DBMS-specific YAML queries**: Optimized queries per DBMS in `src/database/schemas/metadata/`
- **Interactive CLI**: `.help`, `.schema [table]`, `.format [type]`, `.execute`, `.cache`, `.exit`

## Metadata Schema Setup

```bash
# PostgreSQL
psql -U user -d dbname -f sql/postgresql/00_create_schema.sql
# MySQL
mysql -u user -p dbname < sql/mysql/00_create_schema.sql
# Oracle
sqlplus user/pass@dbname @sql/oracle/00_create_schema.sql
# Then run remaining numbered files (01_, 02_, ...) in order
```
