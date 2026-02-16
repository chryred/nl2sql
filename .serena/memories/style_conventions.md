# Style & Conventions

## Module System
- ESM modules (`"type": "module"` in package.json)
- Import paths MUST include `.js` extension
- `import type` for type-only imports

## Naming
- Interfaces: descriptive names (e.g., `ConfigFile`, `ConnectionEntry`)
- Constants: UPPER_SNAKE_CASE (e.g., `DANGEROUS_KEYWORDS`)
- Types: PascalCase (e.g., `OutputFormat`)
- Functions/methods: camelCase

## Documentation
- JSDoc with `@param` and `@returns` for exported functions
- Korean comments acceptable

## Error Handling
- Custom error hierarchy extending `NL2SQLError`
- Errors include `code` and `userMessage`
- `maskSensitiveInfo()` for production logging

## Security
- `validateSQL()` before any SQL execution
- `validateNaturalLanguageInput()` for user input
- Block: DROP, DELETE, TRUNCATE, ALTER, UNION SELECT, SQL comments
- API key format validation

## Database
- Knex.js for query building and connection pooling
- YAML-based schema queries per DBMS
- ConnectionManager for multi-connection lifecycle
- Metadata cache with lazy initialization

## Testing
- Jest with `tests/unit/*.test.ts` pattern
- `describe/it` structure
