/**
 * MCP Tool: glossary_manage
 *
 * 용어집(glossary) 관리 도구 - 추가/수정/비활성화/목록 조회
 * 용어(term), 별칭(alias), 컨텍스트(context)를 함께 관리
 */
import { z } from 'zod';
import { maskSensitiveInfo } from '../../errors/index.js';
import { loadMetadataQueries } from '../../database/metadata/query-loader.js';
import type { ConnectionManager } from '../../database/connection-manager.js';
import { encodeForOracle, resolveOracleTextBind } from '../../database/charset-converter.js';

// ============================================================================
// 공통 유틸
// ============================================================================

/**
 * term → snake_case + 4자리 hex suffix
 * @param term - 용어 이름
 * @returns 용어 코드 (e.g. "k_customer_a3f2")
 */
export function buildTermCode(term: string): string {
  const base = term
    .toLowerCase()
    .replace(/[가-힣]+/g, 'k')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'term';
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `${base}_${suffix}`;
}

// ============================================================================
// 스키마 / 타입 정의
// ============================================================================

const GLOSSARY_CATEGORIES = [
  'CUSTOMER',
  'ORDER',
  'PRODUCT',
  'DATE',
  'STATUS',
  'METRIC',
  'GENERAL',
] as const;

export const glossaryManageInputSchema = z.object({
  connectionId: z.string().optional(),
  action: z.enum(['add', 'update', 'deactivate', 'list']),
  termCode: z.string().optional(),
  term: z.string().optional(),
  category: z.enum(GLOSSARY_CATEGORIES).optional(),
  sqlCondition: z.string().optional(),
  sqlConditionMysql: z.string().optional(),
  sqlConditionOracle: z.string().optional(),
  applyToTables: z.array(z.string()).optional(),
  requiredColumns: z.array(z.string()).optional(),
  definition: z.string().optional(),
  exampleUsage: z.string().optional(),
  priority: z.number().int().optional().default(100),
  aliases: z.array(z.object({
    alias: z.string(),
    locale: z.string().default('ko'),
    matchType: z.enum(['EXACT', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'REGEX']).default('EXACT'),
  })).optional(),
  contexts: z.array(z.object({
    contextSchema: z.string(),
    contextTable: z.string(),
    sqlCondition: z.string(),
    requiredColumns: z.array(z.string()),
    contextDefinition: z.string().optional(),
  })).optional(),
});

export type GlossaryManageInput = z.infer<typeof glossaryManageInputSchema>;

export interface GlossaryManageOutput {
  success: boolean;
  message: string;
  termCode?: string;
  connectionId?: string;
  terms?: Array<{
    termCode: string;
    term: string;
    category: string;
    definition?: string;
  }>;
  error?: string;
}

// ============================================================================
// glossary_manage 메인 함수
// ============================================================================

/**
 * 용어집 관리 (add/update/deactivate/list)
 * @param input - 입력 파라미터
 * @param connManager - 연결 관리자
 * @returns 처리 결과
 */
export async function glossaryManage(
  input: GlossaryManageInput,
  connManager: ConnectionManager
): Promise<GlossaryManageOutput> {
  const entry = connManager.resolve(input.connectionId);
  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
    };
  }

  const { action } = input;

  try {
    if (action === 'list') {
      return await handleList(entry.connectionId, connManager);
    }
    if (action === 'deactivate') {
      return await handleDeactivate(input, entry, connManager);
    }
    // add / update
    return await handleUpsert(input, entry, connManager);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to ${action} glossary term`,
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

// ============================================================================
// list: 캐시에서 용어 목록 반환
// ============================================================================

async function handleList(
  connectionId: string,
  connManager: ConnectionManager
): Promise<GlossaryManageOutput> {
  const cache = await connManager.getOrInitCache(connectionId);
  if (!cache) {
    return {
      success: false,
      message: 'Metadata cache not available. Try cache_refresh first.',
      connectionId,
    };
  }

  const terms = cache.glossaryTerms.map((t) => ({
    termCode: t.termCode,
    term: t.term,
    category: t.category ?? 'GENERAL',
    definition: t.definition,
  }));

  return {
    success: true,
    message: `Found ${terms.length} glossary term(s)`,
    connectionId,
    terms,
  };
}

// ============================================================================
// deactivate: soft delete
// ============================================================================

async function handleDeactivate(
  input: GlossaryManageInput,
  entry: { connectionId: string; knex: import('knex').Knex; params: { type: string; oracleDataCharset?: string } },
  connManager: ConnectionManager
): Promise<GlossaryManageOutput> {
  if (!input.termCode) {
    return {
      success: false,
      message: "Parameter 'termCode' is required for deactivate action.",
    };
  }

  const config = loadMetadataQueries(entry.params.type as 'postgresql' | 'mysql' | 'oracle');
  const deactivateDef = config.queries.glossaryTermDeactivate;
  if (!deactivateDef) {
    return {
      success: false,
      message: `glossaryTermDeactivate SQL not defined for ${entry.params.type}`,
    };
  }

  await entry.knex.raw(deactivateDef.sql, [input.termCode]);
  connManager.invalidateCache(entry.connectionId);

  return {
    success: true,
    message: `Term '${input.termCode}' deactivated`,
    termCode: input.termCode,
    connectionId: entry.connectionId,
  };
}

// ============================================================================
// add / update: UPSERT term + aliases + contexts
// ============================================================================

async function handleUpsert(
  input: GlossaryManageInput,
  entry: { connectionId: string; knex: import('knex').Knex; params: { type: string; oracleDataCharset?: string } },
  connManager: ConnectionManager
): Promise<GlossaryManageOutput> {
  // Validation: add requires term + sqlCondition + requiredColumns + definition
  if (input.action === 'add') {
    if (!input.term || !input.sqlCondition || !input.requiredColumns || !input.definition) {
      return {
        success: false,
        message: "Parameters 'term', 'sqlCondition', 'requiredColumns', and 'definition' are required for add action.",
      };
    }
  }

  const termCode = input.termCode ?? buildTermCode(input.term ?? 'term');
  const dbType = entry.params.type as 'postgresql' | 'mysql' | 'oracle';
  const config = loadMetadataQueries(dbType);

  // ── Term UPSERT ──────────────────────────────────────────────────────
  const termDef = config.queries.glossaryTermUpsert;
  if (!termDef) {
    return { success: false, message: `glossaryTermUpsert SQL not defined for ${dbType}` };
  }

  // apply_to_tables / required_columns: PG=TEXT[], MySQL/Oracle=JSON string
  const applyToTablesVal =
    dbType === 'postgresql'
      ? (input.applyToTables ?? null)
      : input.applyToTables
        ? JSON.stringify(input.applyToTables)
        : null;

  const requiredColumnsVal =
    dbType === 'postgresql'
      ? (input.requiredColumns ?? null)
      : input.requiredColumns
        ? JSON.stringify(input.requiredColumns)
        : null;

  const createdBy = 'mcp_tool';

  if (dbType === 'oracle') {
    await upsertTermOracle(
      entry, termDef.sql, termCode, input, applyToTablesVal, requiredColumnsVal, createdBy
    );
  } else {
    // PostgreSQL / MySQL - 동일한 바인딩 순서
    // PostgreSQL: sql_condition_mysql, sql_condition_oracle
    // MySQL: sql_condition_pg, sql_condition_oracle
    const crossCondition1 =
      dbType === 'postgresql'
        ? (input.sqlConditionMysql ?? null)
        : (input.sqlConditionMysql ?? null); // MySQL: sql_condition_pg 컬럼에 PG 조건 저장 — 여기서는 입력 매핑
    const crossCondition2 = input.sqlConditionOracle ?? null;

    // MySQL의 경우 sql_condition_pg 컬럼은 PG용 조건이지만,
    // 입력 스키마에서 sqlConditionMysql로 받으므로 MySQL YAML 컬럼명에 맞춰야 함.
    // PG YAML: sql_condition_mysql, sql_condition_oracle
    // MySQL YAML: sql_condition_pg, sql_condition_oracle
    // → MySQL에서는 crossCondition1 = sqlCondition (PG용 = 메인 조건이 MySQL용이므로 PG 대체조건 없음)
    // 실제로 MySQL UPSERT 컬럼 순서: sql_condition_pg, sql_condition_oracle
    const mysqlCrossCondition1 = dbType === 'mysql' ? null : (input.sqlConditionMysql ?? null);

    const bindings = [
      termCode,
      input.term ?? null,
      input.category ?? null,
      input.sqlCondition ?? null,
      mysqlCrossCondition1,  // PG: sql_condition_mysql, MySQL: sql_condition_pg
      crossCondition2,       // sql_condition_oracle
      applyToTablesVal,
      requiredColumnsVal,
      input.definition ?? null,
      input.exampleUsage ?? null,
      input.priority ?? 100,
      createdBy,
    ];
    await entry.knex.raw(termDef.sql, bindings);
  }

  // ── Alias UPSERT ─────────────────────────────────────────────────────
  if (input.aliases && input.aliases.length > 0) {
    await upsertAliases(entry, config, dbType, termCode, input.aliases);
  }

  // ── Context UPSERT ────────────────────────────────────────────────────
  if (input.contexts && input.contexts.length > 0) {
    await upsertContexts(entry, config, dbType, termCode, input.contexts);
  }

  // 캐시 무효화
  connManager.invalidateCache(entry.connectionId);

  return {
    success: true,
    message: `Glossary term '${input.term ?? termCode}' registered as '${termCode}'`,
    termCode,
    connectionId: entry.connectionId,
  };
}

// ============================================================================
// Oracle MERGE: Term UPSERT
// ============================================================================

async function upsertTermOracle(
  entry: { knex: import('knex').Knex; params: { type: string; oracleDataCharset?: string } },
  rawSql: string,
  termCode: string,
  input: GlossaryManageInput,
  applyToTablesVal: unknown,
  requiredColumnsVal: unknown,
  createdBy: string
): Promise<void> {
  const charset = entry.params.oracleDataCharset;
  const mergedSql = resolveOracleTextBind(rawSql, charset);

  const enc = (val: string | null | undefined): string | null => {
    if (val == null) return null;
    return charset ? encodeForOracle(val, charset) : val;
  };

  // Oracle MERGE 바인딩 순서:
  // ON절: term_code
  // MATCHED UPDATE: term, category, sql_condition, sql_condition_mysql, sql_condition_oracle,
  //   apply_to_tables, required_columns, definition, example_usage, priority, updated_by
  // NOT MATCHED INSERT: term_code, term, category, sql_condition,
  //   sql_condition_mysql, sql_condition_oracle, apply_to_tables, required_columns,
  //   definition, example_usage, priority, created_by
  const bindings = [
    // ON (SELECT ? AS term_code FROM DUAL)
    termCode,
    // WHEN MATCHED SET
    enc(input.term ?? null),
    input.category ?? null,
    enc(input.sqlCondition ?? null),
    enc(input.sqlConditionMysql ?? null),
    enc(input.sqlConditionOracle ?? null),
    applyToTablesVal,
    requiredColumnsVal,
    enc(input.definition ?? null),
    enc(input.exampleUsage ?? null),
    input.priority ?? 100,
    createdBy,
    // WHEN NOT MATCHED INSERT VALUES
    termCode,
    enc(input.term ?? null),
    input.category ?? null,
    enc(input.sqlCondition ?? null),
    enc(input.sqlConditionMysql ?? null),
    enc(input.sqlConditionOracle ?? null),
    applyToTablesVal,
    requiredColumnsVal,
    enc(input.definition ?? null),
    enc(input.exampleUsage ?? null),
    input.priority ?? 100,
    createdBy,
  ];

  await entry.knex.raw(mergedSql, bindings);
}

// ============================================================================
// Alias UPSERT
// ============================================================================

async function upsertAliases(
  entry: { knex: import('knex').Knex; params: { type: string; oracleDataCharset?: string } },
  config: ReturnType<typeof loadMetadataQueries>,
  dbType: string,
  termCode: string,
  aliases: NonNullable<GlossaryManageInput['aliases']>
): Promise<void> {
  const aliasDef = config.queries.glossaryAliasUpsert;
  if (!aliasDef) return;

  const charset = dbType === 'oracle' ? entry.params.oracleDataCharset : undefined;

  for (const a of aliases) {
    if (dbType === 'oracle') {
      const sql = resolveOracleTextBind(aliasDef.sql, charset);
      const encAlias = charset ? encodeForOracle(a.alias, charset) : a.alias;

      // Oracle MERGE 바인딩: ON절(term_code, alias, locale) + NOT MATCHED INSERT(term_code, alias, locale, match_type)
      const bindings = [
        termCode, encAlias, a.locale,           // ON (SELECT ... FROM DUAL)
        termCode, encAlias, a.locale, a.matchType, // NOT MATCHED INSERT VALUES
      ];
      await entry.knex.raw(sql, bindings);
    } else {
      // PG / MySQL: term_code, alias, locale, match_type
      const bindings = [termCode, a.alias, a.locale, a.matchType];
      await entry.knex.raw(aliasDef.sql, bindings);
    }
  }
}

// ============================================================================
// Context UPSERT
// ============================================================================

async function upsertContexts(
  entry: { knex: import('knex').Knex; params: { type: string; oracleDataCharset?: string } },
  config: ReturnType<typeof loadMetadataQueries>,
  dbType: string,
  termCode: string,
  contexts: NonNullable<GlossaryManageInput['contexts']>
): Promise<void> {
  const ctxDef = config.queries.glossaryContextUpsert;
  if (!ctxDef) return;

  const charset = dbType === 'oracle' ? entry.params.oracleDataCharset : undefined;

  for (const ctx of contexts) {
    const reqColsVal =
      dbType === 'postgresql'
        ? ctx.requiredColumns
        : JSON.stringify(ctx.requiredColumns);

    if (dbType === 'oracle') {
      const sql = resolveOracleTextBind(ctxDef.sql, charset);
      const enc = (v: string | null | undefined): string | null => {
        if (v == null) return null;
        return charset ? encodeForOracle(v, charset) : v;
      };

      // Oracle MERGE 바인딩:
      // ON절: term_code, context_schema, context_table
      // MATCHED UPDATE: sql_condition, required_columns, context_definition
      // NOT MATCHED INSERT: term_code, context_schema, context_table,
      //   sql_condition, required_columns, context_definition
      const bindings = [
        // ON (SELECT ... FROM DUAL)
        termCode, ctx.contextSchema, ctx.contextTable,
        // MATCHED UPDATE SET
        enc(ctx.sqlCondition),
        reqColsVal,
        enc(ctx.contextDefinition ?? null),
        // NOT MATCHED INSERT VALUES
        termCode, ctx.contextSchema, ctx.contextTable,
        enc(ctx.sqlCondition),
        reqColsVal,
        enc(ctx.contextDefinition ?? null),
      ];
      await entry.knex.raw(sql, bindings);
    } else {
      // PG / MySQL: term_code, context_schema, context_table,
      //   sql_condition, required_columns, context_definition
      const bindings = [
        termCode,
        ctx.contextSchema,
        ctx.contextTable,
        ctx.sqlCondition,
        reqColsVal,
        ctx.contextDefinition ?? null,
      ];
      await entry.knex.raw(ctxDef.sql, bindings);
    }
  }
}
