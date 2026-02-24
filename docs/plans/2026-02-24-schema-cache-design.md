# Schema Cache Per Connection Design

**Date:** 2026-02-24
**Status:** Approved

## Problem

`NL2SQLEngine` caches schema in an instance-level field (`cachedSchema`). In MCP mode a new engine
instance is created per request, so schema is re-extracted from the database on every call.
`MetadataCache` is already cached per connection in `ConnectionManager`; schema cache should follow
the same pattern.

## Scope

| Area | Change |
|------|--------|
| `ConnectionEntry` | Add `schemaCache` + `schemaCacheInitPromise` fields |
| `ConnectionManager` | Add `getOrInitSchemaCache`, `invalidateSchemaCache`, `refreshSchemaCache` |
| `NL2SQLEngineOptions` | Add `schemaCache?: SchemaInfo \| null` |
| `NL2SQLEngine.getSchema()` | Use injected cache when provided |
| `nl2sql_query` MCP tool | Inject `schemaCache` from `ConnectionManager` |
| `nl2sql_schema` MCP tool | Use `ConnectionManager.getOrInitSchemaCache` instead of direct `extractSchema` |
| `cache_refresh` MCP tool | Invalidate schema cache alongside metadata cache |
| CLI commands | No behavioural change; `schemaCache` option defaults to `undefined` (internal cache) |

## Data Model

```typescript
// connection-manager.ts
export interface ConnectionEntry {
  connectionId: string;
  params: ConnectionParams;
  knex: Knex;
  metadataCache: MetadataCache | null;
  cacheInitPromise: Promise<MetadataCache | null> | null;
  schemaCache: SchemaInfo | null;                          // NEW
  schemaCacheInitPromise: Promise<SchemaInfo | null> | null; // NEW
  createdAt: Date;
  lastUsedAt: Date;
}

// nl2sql-engine.ts
export interface NL2SQLEngineOptions {
  useMetadata?: boolean;
  metadataCache?: MetadataCache | null;
  schemaCache?: SchemaInfo | null;  // NEW: undefined=internal cache, null=always extract, value=use as-is
}
```

## ConnectionManager New Methods

```typescript
/** Returns cached schema or extracts and caches it (concurrent-safe). */
async getOrInitSchemaCache(connectionId: string, config: Config): Promise<SchemaInfo | null>

/** Clears schema cache (next call will re-extract). */
invalidateSchemaCache(connectionId: string): void

/** Force-reloads schema cache. */
async refreshSchemaCache(connectionId: string, config: Config): Promise<SchemaInfo | null>
```

Implementation mirrors `getOrInitCache` / `refreshCache` exactly.

## NL2SQLEngine.getSchema() Logic

```
if injectedSchemaCache is defined and non-null → return injectedSchemaCache
if this.cachedSchema → return this.cachedSchema          (internal cache path, CLI)
extract from DB, store in this.cachedSchema, return it
```

## MCP Tool Changes

### nl2sql_query
```typescript
const schemaCache = await connManager.getOrInitSchemaCache(entry.connectionId, config);
const engine = new NL2SQLEngine(entry.knex, config, { metadataCache, schemaCache });
```

### nl2sql_schema
```typescript
const schema = await connManager.getOrInitSchemaCache(entry.connectionId, config);
// (fallback to extractSchema if null)
```

### cache_refresh
```typescript
await Promise.all([
  connManager.refreshCache(connectionId),
  connManager.refreshSchemaCache(connectionId, config),
]);
```

## CLI Mode

No structural changes. `NL2SQLEngine` without `schemaCache` option continues to use its
instance-level `cachedSchema`. `InteractiveSession` already reuses a single engine instance,
so schema remains cached for the session.

## Files to Change

1. `src/database/connection-manager.ts` — `ConnectionEntry` + 3 new methods
2. `src/core/nl2sql-engine.ts` — `NL2SQLEngineOptions` + `getSchema()` update
3. `src/mcp/tools/nl2sql-query.ts` — inject `schemaCache`
4. `src/mcp/tools/nl2sql-schema.ts` — use `getOrInitSchemaCache`
5. `src/mcp/tools/cache-manage.ts` — refresh schema cache on `cache_refresh`
