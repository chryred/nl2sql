/**
 * MCP Tool: relationship_manage
 *
 * 테이블 관계(table_relationships)를 직접 관리합니다.
 * add: UPSERT, activate: 활성화, deactivate: 비활성화, list: 캐시 조회
 *
 * @module mcp/tools/relationship-manage
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
 * Oracle inferenceUpsert의 {{DESCRIPTION_BIND}} 플레이스홀더를 charset 유무에 따라 치환합니다.
 * @param sql - {{DESCRIPTION_BIND}} 플레이스홀더를 포함한 SQL 문자열
 * @param charset - Oracle 데이터 인코딩 (예: 'ms949')
 * @returns 치환된 SQL 문자열
 */
function resolveDescriptionBind(sql: string, charset?: string): string {
  const binding = charset
    ? 'UTL_RAW.CAST_TO_VARCHAR2(HEXTORAW(?))'
    : '?';
  return sql.replace(/\{\{DESCRIPTION_BIND\}\}/g, binding);
}

/**
 * 6개 필수 컬럼(source/target schema+table+column) 유효성 검증
 * @param input - 입력 객체
 * @returns 에러 메시지 또는 null
 */
function validateSixColumns(input: RelationshipManageInput): string | null {
  const required = [
    'sourceSchema', 'sourceTable', 'sourceColumn',
    'targetSchema', 'targetTable', 'targetColumn',
  ] as const;
  const missing = required.filter((k) => !input[k]);
  if (missing.length > 0) {
    return `Missing required fields: ${missing.join(', ')}`;
  }
  return null;
}

// ============================================================================
// 스키마 & 타입
// ============================================================================

export const relationshipManageInputSchema = z.object({
  connectionId: z.string().optional(),
  action: z.enum(['add', 'activate', 'deactivate', 'list']),
  sourceSchema: z.string().optional(),
  sourceTable: z.string().optional(),
  sourceColumn: z.string().optional(),
  targetSchema: z.string().optional(),
  targetTable: z.string().optional(),
  targetColumn: z.string().optional(),
  relationshipType: z
    .enum(['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'])
    .optional()
    .default('MANY_TO_ONE'),
  confidenceLevel: z
    .enum(['HIGH', 'MEDIUM', 'LOW'])
    .optional()
    .default('HIGH'),
  joinHint: z
    .enum(['INNER', 'LEFT', 'RIGHT'])
    .optional()
    .default('LEFT'),
  description: z.string().optional(),
});

export type RelationshipManageInput = z.infer<typeof relationshipManageInputSchema>;

export interface RelationshipManageOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  relationships?: Array<{
    sourceTable: string;
    sourceColumn: string;
    targetTable: string;
    targetColumn: string;
    relationshipType?: string;
  }>;
  error?: string;
}

// ============================================================================
// 메인 함수
// ============================================================================

/**
 * 테이블 관계를 관리합니다.
 * @param input - 입력 파라미터
 * @param connManager - ConnectionManager 인스턴스
 * @returns 관계 관리 결과
 */
export async function relationshipManage(
  input: RelationshipManageInput,
  connManager: ConnectionManager
): Promise<RelationshipManageOutput> {
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
        return await handleActivate(input, entry, connManager);
      case 'deactivate':
        return await handleDeactivate(input, entry, connManager);
      case 'list':
        return await handleList(entry, connManager);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to ${input.action} relationship`,
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

// ============================================================================
// action: add
// ============================================================================

import type { ConnectionEntry } from '../../database/connection-manager.js';

async function handleAdd(
  input: RelationshipManageInput,
  entry: ConnectionEntry,
  connManager: ConnectionManager
): Promise<RelationshipManageOutput> {
  const validationError = validateSixColumns(input);
  if (validationError) {
    return { success: false, message: validationError, connectionId: entry.connectionId };
  }

  const dbType = entry.params.type;
  const config = loadMetadataQueries(dbType);
  const upsertDef = config.queries.inferenceUpsert;
  if (!upsertDef) {
    return { success: false, message: `inferenceUpsert SQL not defined for ${dbType}` };
  }

  const isActiveVal = dbType === 'oracle' || dbType === 'mysql' ? 1 : true;
  const descriptionVal = input.description ?? null;

  if (dbType === 'oracle') {
    const charset = entry.params.oracleDataCharset;
    const mergedSql = resolveDescriptionBind(upsertDef.sql, charset);

    const encodedDesc = descriptionVal && charset
      ? encodeForOracle(descriptionVal, charset)
      : descriptionVal;

    // Oracle MERGE: 6 ON clause + 6 INSERT VALUES (type, confidence, joinHint, description, isActive, createdBy)
    const bindings: unknown[] = [
      input.sourceSchema,
      input.sourceTable,
      input.sourceColumn,
      input.targetSchema,
      input.targetTable,
      input.targetColumn,
      input.relationshipType,
      input.confidenceLevel,
      input.joinHint,
      encodedDesc,
      isActiveVal,
      'mcp_user',
    ];
    await entry.knex.raw(mergedSql, bindings);
  } else {
    // PostgreSQL / MySQL: 12 bindings for INSERT
    const bindings: unknown[] = [
      input.sourceSchema,
      input.sourceTable,
      input.sourceColumn,
      input.targetSchema,
      input.targetTable,
      input.targetColumn,
      input.relationshipType,
      input.confidenceLevel,
      input.joinHint,
      descriptionVal,
      isActiveVal,
      'mcp_user',
    ];
    await entry.knex.raw(upsertDef.sql, bindings);
  }

  connManager.invalidateCache(entry.connectionId);

  return {
    success: true,
    message: `Relationship added: ${input.sourceTable}.${input.sourceColumn} -> ${input.targetTable}.${input.targetColumn}`,
    connectionId: entry.connectionId,
  };
}

// ============================================================================
// action: activate
// ============================================================================

async function handleActivate(
  input: RelationshipManageInput,
  entry: ConnectionEntry,
  connManager: ConnectionManager
): Promise<RelationshipManageOutput> {
  const validationError = validateSixColumns(input);
  if (validationError) {
    return { success: false, message: validationError, connectionId: entry.connectionId };
  }

  const dbType = entry.params.type;
  const sql = dbType === 'oracle'
    ? `UPDATE table_relationships SET is_active = 1, updated_at = SYSTIMESTAMP WHERE source_schema = ? AND source_table = ? AND source_column = ? AND target_schema = ? AND target_table = ? AND target_column = ?`
    : dbType === 'mysql'
      ? `UPDATE table_relationships SET is_active = 1, updated_at = NOW() WHERE source_schema = ? AND source_table = ? AND source_column = ? AND target_schema = ? AND target_table = ? AND target_column = ?`
      : `UPDATE table_relationships SET is_active = TRUE, updated_at = NOW() WHERE source_schema = ? AND source_table = ? AND source_column = ? AND target_schema = ? AND target_table = ? AND target_column = ?`;

  const bindings = [
    input.sourceSchema,
    input.sourceTable,
    input.sourceColumn,
    input.targetSchema,
    input.targetTable,
    input.targetColumn,
  ];

  await entry.knex.raw(sql, bindings);
  connManager.invalidateCache(entry.connectionId);

  return {
    success: true,
    message: `Relationship activated: ${input.sourceTable}.${input.sourceColumn} -> ${input.targetTable}.${input.targetColumn}`,
    connectionId: entry.connectionId,
  };
}

// ============================================================================
// action: deactivate
// ============================================================================

async function handleDeactivate(
  input: RelationshipManageInput,
  entry: ConnectionEntry,
  connManager: ConnectionManager
): Promise<RelationshipManageOutput> {
  const validationError = validateSixColumns(input);
  if (validationError) {
    return { success: false, message: validationError, connectionId: entry.connectionId };
  }

  const dbType = entry.params.type;
  const config = loadMetadataQueries(dbType);
  const deactivateDef = config.queries.relationshipDeactivate;
  if (!deactivateDef) {
    return { success: false, message: `relationshipDeactivate SQL not defined for ${dbType}` };
  }

  const bindings = [
    input.sourceSchema,
    input.sourceTable,
    input.sourceColumn,
    input.targetSchema,
    input.targetTable,
    input.targetColumn,
  ];

  await entry.knex.raw(deactivateDef.sql, bindings);
  connManager.invalidateCache(entry.connectionId);

  return {
    success: true,
    message: `Relationship deactivated: ${input.sourceTable}.${input.sourceColumn} -> ${input.targetTable}.${input.targetColumn}`,
    connectionId: entry.connectionId,
  };
}

// ============================================================================
// action: list
// ============================================================================

async function handleList(
  entry: ConnectionEntry,
  connManager: ConnectionManager
): Promise<RelationshipManageOutput> {
  const cache = await connManager.getOrInitCache(entry.connectionId);
  if (!cache) {
    return {
      success: true,
      message: 'No metadata cache available',
      connectionId: entry.connectionId,
      relationships: [],
    };
  }

  const relationships = cache.relationships.map((r) => ({
    sourceTable: r.sourceTable,
    sourceColumn: r.sourceColumn,
    targetTable: r.targetTable,
    targetColumn: r.targetColumn,
    relationshipType: r.relationshipType,
  }));

  return {
    success: true,
    message: `Found ${relationships.length} relationships`,
    connectionId: entry.connectionId,
    relationships,
  };
}
