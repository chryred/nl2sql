/**
 * MCP Tool: naming_convention_manage
 *
 * 네이밍 컨벤션 규칙의 CRUD 관리 (add/update/deactivate/list)
 *
 * @module mcp/tools/naming-convention-manage
 */
import { z } from 'zod';
import { maskSensitiveInfo } from '../../errors/index.js';
import { loadMetadataQueries } from '../../database/metadata/query-loader.js';
import type { ConnectionManager, ConnectionEntry } from '../../database/connection-manager.js';
import { encodeForOracle, resolveOracleTextBind } from '../../database/charset-converter.js';

// ============================================================================
// Input Schema
// ============================================================================

export const namingConventionManageInputSchema = z.object({
  connectionId: z.string().optional(),
  action: z.enum(['add', 'update', 'deactivate', 'list']),
  conventionName: z.string().optional(),
  columnPattern: z.string().optional(),
  targetTablePattern: z.string().optional(),
  targetColumnPattern: z.string().optional().default('id'),
  tablePrefixStrip: z.string().optional(),
  tableSuffixStrip: z.string().optional(),
  applyPluralization: z.boolean().optional().default(true),
  priority: z.number().int().optional().default(100),
  applyToSchemas: z.array(z.string()).optional(),
  excludeTables: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export type NamingConventionManageInput = z.infer<typeof namingConventionManageInputSchema>;

// ============================================================================
// Output Interface
// ============================================================================

export interface NamingConventionManageOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  conventions?: Array<{
    name: string;
    columnPattern: string;
    targetTablePattern: string;
    priority: number;
  }>;
  error?: string;
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * 네이밍 컨벤션 관리 도구
 *
 * @param input - 액션 및 컨벤션 데이터
 * @param connManager - ConnectionManager 인스턴스
 * @returns 처리 결과
 */
export async function namingConventionManage(
  input: NamingConventionManageInput,
  connManager: ConnectionManager
): Promise<NamingConventionManageOutput> {
  const entry = connManager.resolve(input.connectionId);
  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
    };
  }

  switch (input.action) {
    case 'add':
    case 'update':
      return upsertConvention(input, entry, connManager);
    case 'deactivate':
      return deactivateConvention(input, entry, connManager);
    case 'list':
      return listConventions(entry, connManager);
  }
}

// ============================================================================
// add / update (UPSERT)
// ============================================================================

async function upsertConvention(
  input: NamingConventionManageInput,
  entry: ConnectionEntry,
  connManager: ConnectionManager
): Promise<NamingConventionManageOutput> {
  if (!input.conventionName) {
    return { success: false, message: 'conventionName is required for add/update action' };
  }
  if (!input.columnPattern) {
    return { success: false, message: 'columnPattern is required for add/update action' };
  }
  if (!input.targetTablePattern) {
    return { success: false, message: 'targetTablePattern is required for add/update action' };
  }

  const dbType = entry.params.type;

  try {
    const config = loadMetadataQueries(dbType);
    const upsertDef = config.queries.namingConventionUpsert;
    if (!upsertDef) {
      return { success: false, message: `namingConventionUpsert SQL not defined for ${dbType}` };
    }

    // arrays: PG=native array, MySQL/Oracle=JSON string
    const applyToSchemasVal =
      dbType === 'postgresql'
        ? (input.applyToSchemas ?? null)
        : input.applyToSchemas
          ? JSON.stringify(input.applyToSchemas)
          : null;

    const excludeTablesVal =
      dbType === 'postgresql'
        ? (input.excludeTables ?? null)
        : input.excludeTables
          ? JSON.stringify(input.excludeTables)
          : null;

    // boolean: PG=boolean, MySQL/Oracle=1/0
    const pluralizationVal =
      dbType === 'postgresql'
        ? input.applyPluralization
        : input.applyPluralization ? 1 : 0;

    let bindings: unknown[];

    if (dbType === 'oracle') {
      const charset = entry.params.oracleDataCharset;
      const mergedSql = resolveOracleTextBind(upsertDef.sql, charset);

      const encodedDesc =
        input.description && charset
          ? encodeForOracle(input.description, charset)
          : (input.description ?? null);

      bindings = [
        // ON (SELECT ? AS convention_name FROM DUAL)
        input.conventionName,
        // WHEN MATCHED SET
        input.columnPattern,
        input.targetTablePattern,
        input.targetColumnPattern ?? 'id',
        input.tablePrefixStrip ?? null,
        input.tableSuffixStrip ?? null,
        pluralizationVal,
        input.priority ?? 100,
        applyToSchemasVal,
        excludeTablesVal,
        encodedDesc,
        // WHEN NOT MATCHED INSERT VALUES
        input.conventionName,
        input.columnPattern,
        input.targetTablePattern,
        input.targetColumnPattern ?? 'id',
        input.tablePrefixStrip ?? null,
        input.tableSuffixStrip ?? null,
        pluralizationVal,
        input.priority ?? 100,
        applyToSchemasVal,
        excludeTablesVal,
        encodedDesc,
      ];
      await entry.knex.raw(mergedSql, bindings);
    } else {
      // PostgreSQL / MySQL: INSERT column order matches YAML
      bindings = [
        input.conventionName,
        input.columnPattern,
        input.targetTablePattern,
        input.targetColumnPattern ?? 'id',
        input.tablePrefixStrip ?? null,
        input.tableSuffixStrip ?? null,
        pluralizationVal,
        input.priority ?? 100,
        applyToSchemasVal,
        excludeTablesVal,
        input.description ?? null,
      ];
      await entry.knex.raw(upsertDef.sql, bindings);
    }

    connManager.invalidateCache(entry.connectionId);

    return {
      success: true,
      message: `Naming convention '${input.conventionName}' ${input.action === 'add' ? 'added' : 'updated'} successfully`,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to ${input.action} naming convention`,
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

// ============================================================================
// deactivate
// ============================================================================

async function deactivateConvention(
  input: NamingConventionManageInput,
  entry: { connectionId: string; params: { type: string }; knex: import('knex').Knex },
  connManager: ConnectionManager
): Promise<NamingConventionManageOutput> {
  if (!input.conventionName) {
    return { success: false, message: 'conventionName is required for deactivate action' };
  }

  const dbType = entry.params.type;

  try {
    let sql: string;
    if (dbType === 'oracle') {
      sql = `UPDATE naming_conventions SET is_active = 0, updated_at = SYSTIMESTAMP WHERE convention_name = ?`;
    } else if (dbType === 'mysql') {
      sql = `UPDATE naming_conventions SET is_active = 0, updated_at = NOW() WHERE convention_name = ?`;
    } else {
      sql = `UPDATE naming_conventions SET is_active = FALSE, updated_at = NOW() WHERE convention_name = ?`;
    }

    await entry.knex.raw(sql, [input.conventionName]);
    connManager.invalidateCache(entry.connectionId);

    return {
      success: true,
      message: `Naming convention '${input.conventionName}' deactivated`,
      connectionId: entry.connectionId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to deactivate naming convention',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

// ============================================================================
// list (from cache)
// ============================================================================

async function listConventions(
  entry: { connectionId: string },
  connManager: ConnectionManager
): Promise<NamingConventionManageOutput> {
  try {
    const cache = await connManager.getOrInitCache(entry.connectionId);
    if (!cache) {
      return {
        success: false,
        message: 'Metadata cache not available. Try cache_refresh first.',
        connectionId: entry.connectionId,
      };
    }

    const conventions = cache.namingConventions.map((nc) => ({
      name: nc.name,
      columnPattern: nc.columnPattern,
      targetTablePattern: nc.targetTablePattern,
      priority: nc.priority,
    }));

    return {
      success: true,
      message: `Found ${conventions.length} naming convention(s)`,
      connectionId: entry.connectionId,
      conventions,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to list naming conventions',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}
