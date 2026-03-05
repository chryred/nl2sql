/**
 * MCP Tool: code_table_manage
 *
 * 코드 테이블, 컬럼-코드 매핑, 코드 별칭을 관리하는 통합 도구.
 * Actions: add, activate, deactivate, add_mapping, add_alias, list
 */
import { z } from 'zod';
import { maskSensitiveInfo } from '../../errors/index.js';
import { loadMetadataQueries } from '../../database/metadata/query-loader.js';
import type { ConnectionManager } from '../../database/connection-manager.js';
import { encodeForOracle, resolveOracleTextBind } from '../../database/charset-converter.js';

// ============================================================================
// Schema
// ============================================================================

export const codeTableManageInputSchema = z.object({
  connectionId: z.string().optional(),
  action: z.enum(['add', 'activate', 'deactivate', 'add_mapping', 'add_alias', 'list']),
  // For add / activate / deactivate:
  codeTableName: z.string().optional(),
  tableSchema: z.string().optional(),
  tableName: z.string().optional(),
  groupCodeColumn: z.string().optional(),
  codeColumn: z.string().optional(),
  codeNameColumn: z.string().optional(),
  descriptionColumn: z.string().optional(),
  sortOrderColumn: z.string().optional(),
  activeFlagColumn: z.string().optional(),
  activeFlagValue: z.string().optional(),
  description: z.string().optional(),
  // For add_mapping:
  targetSchema: z.string().optional(),
  targetTable: z.string().optional(),
  targetColumn: z.string().optional(),
  groupCode: z.string().optional(),
  displayName: z.string().optional(),
  includeInPrompt: z.boolean().optional().default(true),
  // For add_alias:
  codeValue: z.string().optional(),
  alias: z.string().optional(),
  locale: z.string().optional().default('ko'),
});

export type CodeTableManageInput = z.infer<typeof codeTableManageInputSchema>;

export interface CodeTableManageOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  codeTables?: Array<{ codeTableName: string; tableName: string; tableSchema: string }>;
  error?: string;
}

// ============================================================================
// Main handler
// ============================================================================

/**
 * 코드 테이블 관리 도구
 * @param input - 입력 파라미터
 * @param connManager - 연결 관리자
 * @returns 실행 결과
 */
export async function codeTableManage(
  input: CodeTableManageInput,
  connManager: ConnectionManager
): Promise<CodeTableManageOutput> {
  const entry = connManager.resolve(input.connectionId);
  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
    };
  }

  try {
    switch (input.action) {
      case 'add':
        return await handleAdd(input, entry, connManager);
      case 'activate':
        return await handleActivateDeactivate(input, entry, connManager, true);
      case 'deactivate':
        return await handleActivateDeactivate(input, entry, connManager, false);
      case 'add_mapping':
        return await handleAddMapping(input, entry, connManager);
      case 'add_alias':
        return await handleAddAlias(input, entry, connManager);
      case 'list':
        return await handleList(entry, connManager);
      default:
        return { success: false, message: `Unknown action: ${input.action}` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to execute code_table_manage (${input.action})`,
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

// ============================================================================
// action: add
// ============================================================================

async function handleAdd(
  input: CodeTableManageInput,
  entry: import('../../database/connection-manager.js').ConnectionEntry,
  connManager: ConnectionManager
): Promise<CodeTableManageOutput> {
  if (!input.codeTableName || !input.tableName || !input.codeColumn || !input.codeNameColumn) {
    return {
      success: false,
      message: 'action=add requires: codeTableName, tableName, codeColumn, codeNameColumn',
    };
  }

  const dbType = entry.params.type;
  const config = loadMetadataQueries(dbType);
  const upsertDef = config.queries.codeTableUpsert;
  if (!upsertDef) {
    return { success: false, message: `codeTableUpsert SQL not defined for ${dbType}` };
  }

  if (dbType === 'oracle') {
    const charset = entry.params.oracleDataCharset;
    const mergedSql = resolveOracleTextBind(upsertDef.sql, charset);
    const encodedDesc = input.description && charset
      ? encodeForOracle(input.description, charset)
      : (input.description ?? null);

    // Oracle MERGE bindings: ON절 + MATCHED SET + NOT MATCHED INSERT
    const bindings: unknown[] = [
      // ON (SELECT ? AS code_table_name FROM DUAL)
      input.codeTableName,
      // WHEN MATCHED SET
      input.tableSchema ?? null,
      input.tableName,
      input.groupCodeColumn ?? null,
      input.codeColumn,
      input.codeNameColumn,
      input.descriptionColumn ?? null,
      input.sortOrderColumn ?? null,
      input.activeFlagColumn ?? null,
      input.activeFlagValue ?? null,
      1, // is_active
      encodedDesc,
      // WHEN NOT MATCHED INSERT VALUES
      input.codeTableName,
      input.tableSchema ?? null,
      input.tableName,
      input.groupCodeColumn ?? null,
      input.codeColumn,
      input.codeNameColumn,
      input.descriptionColumn ?? null,
      input.sortOrderColumn ?? null,
      input.activeFlagColumn ?? null,
      input.activeFlagValue ?? null,
      1, // is_active
      encodedDesc,
    ];
    await entry.knex.raw(mergedSql, bindings);
  } else {
    const bindings: unknown[] = [
      input.codeTableName,
      input.tableSchema ?? null,
      input.tableName,
      input.groupCodeColumn ?? null,
      input.codeColumn,
      input.codeNameColumn,
      input.descriptionColumn ?? null,
      input.sortOrderColumn ?? null,
      input.activeFlagColumn ?? null,
      input.activeFlagValue ?? null,
      dbType === 'mysql' ? 1 : true, // is_active
      input.description ?? null,
    ];
    await entry.knex.raw(upsertDef.sql, bindings);
  }

  connManager.invalidateCache(entry.connectionId);

  return {
    success: true,
    message: `Code table '${input.codeTableName}' registered successfully`,
    connectionId: entry.connectionId,
  };
}

// ============================================================================
// action: activate / deactivate
// ============================================================================

async function handleActivateDeactivate(
  input: CodeTableManageInput,
  entry: import('../../database/connection-manager.js').ConnectionEntry,
  connManager: ConnectionManager,
  activate: boolean
): Promise<CodeTableManageOutput> {
  if (!input.codeTableName) {
    return {
      success: false,
      message: `action=${activate ? 'activate' : 'deactivate'} requires: codeTableName`,
    };
  }

  const dbType = entry.params.type;
  const activeVal = activate
    ? (dbType === 'postgresql' ? 'TRUE' : '1')
    : (dbType === 'postgresql' ? 'FALSE' : '0');
  const nowFn = dbType === 'oracle' ? 'SYSTIMESTAMP' : 'NOW()';

  const sql = `UPDATE code_tables SET is_active = ${activeVal}, updated_at = ${nowFn} WHERE code_table_name = ?`;
  await entry.knex.raw(sql, [input.codeTableName]);

  connManager.invalidateCache(entry.connectionId);

  const verb = activate ? 'activated' : 'deactivated';
  return {
    success: true,
    message: `Code table '${input.codeTableName}' ${verb}`,
    connectionId: entry.connectionId,
  };
}

// ============================================================================
// action: add_mapping
// ============================================================================

async function handleAddMapping(
  input: CodeTableManageInput,
  entry: import('../../database/connection-manager.js').ConnectionEntry,
  connManager: ConnectionManager
): Promise<CodeTableManageOutput> {
  if (!input.targetSchema || !input.targetTable || !input.targetColumn || !input.codeTableName) {
    return {
      success: false,
      message: 'action=add_mapping requires: targetSchema, targetTable, targetColumn, codeTableName',
    };
  }

  const dbType = entry.params.type;
  const config = loadMetadataQueries(dbType);
  const upsertDef = config.queries.columnCodeMappingUpsert;
  if (!upsertDef) {
    return { success: false, message: `columnCodeMappingUpsert SQL not defined for ${dbType}` };
  }

  if (dbType === 'oracle') {
    const charset = entry.params.oracleDataCharset;
    const mergedSql = resolveOracleTextBind(upsertDef.sql, charset);
    const encodedDisplayName = input.displayName && charset
      ? encodeForOracle(input.displayName, charset)
      : (input.displayName ?? null);
    const encodedDesc = input.description && charset
      ? encodeForOracle(input.description, charset)
      : (input.description ?? null);

    // Oracle MERGE bindings: ON절 + MATCHED SET + NOT MATCHED INSERT
    const bindings: unknown[] = [
      // ON (SELECT ? AS target_schema, ? AS target_table, ? AS target_column FROM DUAL)
      input.targetSchema,
      input.targetTable,
      input.targetColumn,
      // WHEN MATCHED SET
      input.codeTableName,
      input.groupCode ?? null,
      encodedDisplayName,
      input.includeInPrompt ? 1 : 0,
      1, // is_active
      encodedDesc,
      // WHEN NOT MATCHED INSERT VALUES
      input.targetSchema,
      input.targetTable,
      input.targetColumn,
      input.codeTableName,
      input.groupCode ?? null,
      encodedDisplayName,
      input.includeInPrompt ? 1 : 0,
      1, // is_active
      encodedDesc,
    ];
    await entry.knex.raw(mergedSql, bindings);
  } else {
    const bindings: unknown[] = [
      input.targetSchema,
      input.targetTable,
      input.targetColumn,
      input.codeTableName,
      input.groupCode ?? null,
      input.displayName ?? null,
      dbType === 'mysql' ? (input.includeInPrompt ? 1 : 0) : input.includeInPrompt,
      dbType === 'mysql' ? 1 : true, // is_active
      input.description ?? null,
    ];
    await entry.knex.raw(upsertDef.sql, bindings);
  }

  connManager.invalidateCache(entry.connectionId);

  return {
    success: true,
    message: `Mapping '${input.targetTable}.${input.targetColumn}' -> '${input.codeTableName}' registered`,
    connectionId: entry.connectionId,
  };
}

// ============================================================================
// action: add_alias
// ============================================================================

async function handleAddAlias(
  input: CodeTableManageInput,
  entry: import('../../database/connection-manager.js').ConnectionEntry,
  connManager: ConnectionManager
): Promise<CodeTableManageOutput> {
  if (!input.codeTableName || !input.codeValue || !input.alias) {
    return {
      success: false,
      message: 'action=add_alias requires: codeTableName, codeValue, alias',
    };
  }

  const dbType = entry.params.type;
  const config = loadMetadataQueries(dbType);
  const upsertDef = config.queries.codeAliasUpsert;
  if (!upsertDef) {
    return { success: false, message: `codeAliasUpsert SQL not defined for ${dbType}` };
  }

  if (dbType === 'oracle') {
    const charset = entry.params.oracleDataCharset;
    const mergedSql = resolveOracleTextBind(upsertDef.sql, charset);
    const encodedAlias = input.alias && charset
      ? encodeForOracle(input.alias, charset)
      : input.alias;

    // Oracle MERGE bindings:
    // ON (SELECT ? AS code_table_name, ? AS group_code, {{BIND_TEXT}} AS alias, ? AS locale FROM DUAL)
    // WHEN NOT MATCHED INSERT VALUES (?, ?, ?, {{BIND_TEXT}}, ?, 1)
    const bindings: unknown[] = [
      input.codeTableName,
      input.groupCode ?? null,
      encodedAlias,
      input.locale ?? 'ko',
      // NOT MATCHED VALUES
      input.codeTableName,
      input.groupCode ?? null,
      input.codeValue,
      encodedAlias,
      input.locale ?? 'ko',
    ];
    await entry.knex.raw(mergedSql, bindings);
  } else {
    const bindings: unknown[] = [
      input.codeTableName,
      input.groupCode ?? null,
      input.codeValue,
      input.alias,
      input.locale ?? 'ko',
    ];
    await entry.knex.raw(upsertDef.sql, bindings);
  }

  connManager.invalidateCache(entry.connectionId);

  return {
    success: true,
    message: `Alias '${input.alias}' for code '${input.codeValue}' in '${input.codeTableName}' registered`,
    connectionId: entry.connectionId,
  };
}

// ============================================================================
// action: list
// ============================================================================

async function handleList(
  entry: import('../../database/connection-manager.js').ConnectionEntry,
  connManager: ConnectionManager
): Promise<CodeTableManageOutput> {
  const cache = await connManager.getOrInitCache(entry.connectionId);
  if (!cache) {
    return {
      success: false,
      message: 'Metadata cache not available. Try cache_refresh first.',
      connectionId: entry.connectionId,
    };
  }

  const codeTables = cache.codeTables.map((ct) => ({
    codeTableName: ct.codeTableName,
    tableName: ct.tableName,
    tableSchema: ct.tableSchema,
  }));

  return {
    success: true,
    message: `Found ${codeTables.length} code table(s), ${cache.columnCodeMappings.length} mapping(s), ${cache.codeAliases.length} alias(es)`,
    codeTables,
    connectionId: entry.connectionId,
  };
}
