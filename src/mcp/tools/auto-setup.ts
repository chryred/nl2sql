/**
 * MCP Tool: auto_setup
 *
 * 단일 도구로 전체 메타데이터를 자동 셋업합니다.
 * preview 모드: 각 stage별 후보 수만 반환 (DB 변경 없음)
 * apply  모드: 모든 stage를 순차 실행 후 캐시 1회 무효화
 *
 * @module mcp/tools/auto-setup
 */
import { z } from 'zod';
import type { ConnectionManager } from '../../database/connection-manager.js';
import type { ConnectionEntry } from '../../database/connection-manager.js';
import { loadMetadataQueries } from '../../database/metadata/query-loader.js';
import { maskSensitiveInfo } from '../../errors/index.js';
import { buildConfigFromEntry } from '../utils/config-helper.js';
import { createAIClient } from '../../ai/client-factory.js';
import { extractSchema } from '../../database/schema-extractor.js';
import {
  inferRelationships,
  applyInferredRelationships,
} from '../../database/metadata/relationship-inference.js';
import {
  generateGlossaryTerms,
  applyGlossaryTerms,
} from '../../database/glossary-generator.js';
import {
  generateCodeAliases,
  applyCodeAliases,
} from '../../database/code-alias-generator.js';
import {
  generateQueryPatterns,
  applyQueryPatterns,
} from '../../database/pattern-generator.js';
import { resolveOracleTextBind } from '../../database/charset-converter.js';
import type { DatabaseType } from '../../database/types.js';

// ============================================================================
// Input Schema
// ============================================================================

const STAGE_NAMES = [
  'fk_extraction',
  'code_table_detection',
  'code_mapping_detection',
  'naming_convention',
  'llm_relationship',
  'glossary_generation',
  'code_alias_generation',
  'pattern_generation',
] as const;

export type AutoSetupStage = (typeof STAGE_NAMES)[number];

export const autoSetupInputSchema = z.object({
  connectionId: z.string().optional(),
  mode: z.enum(['preview', 'apply']),
  stages: z.array(z.enum(STAGE_NAMES)).optional(),
  schema: z.string().optional(),
});

export type AutoSetupInput = z.infer<typeof autoSetupInputSchema>;

// ============================================================================
// Output Interface
// ============================================================================

export interface StageResult {
  stage: AutoSetupStage;
  candidates: number;
  applied?: number;
  skipped?: number;
  duration?: number;
  error?: string;
}

export interface AutoSetupOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  mode: 'preview' | 'apply';
  stages: StageResult[];
  error?: string;
}

// ============================================================================
// 유틸: DB 결과 행 추출
// ============================================================================

function extractRows(result: unknown, dbType: DatabaseType): Record<string, unknown>[] {
  if (dbType === 'mysql') {
    return ((result as [Record<string, unknown>[]])[0]) ?? [];
  }
  return ((result as { rows: Record<string, unknown>[] }).rows) ?? [];
}

// ============================================================================
// Stage 1: FK 제약조건 추출
// ============================================================================

async function runFKExtraction(
  entry: ConnectionEntry,
  mode: 'preview' | 'apply'
): Promise<StageResult> {
  const start = Date.now();
  const stage: AutoSetupStage = 'fk_extraction';
  const dbType = entry.params.type;
  const config = loadMetadataQueries(dbType);

  const selectDef = config.queries.autoImportFKSelect;
  const upsertDef = config.queries.inferenceUpsert;
  if (!selectDef || !upsertDef) {
    return { stage, candidates: 0, error: `Required SQL not defined for ${dbType}` };
  }

  try {
    const rawResult = await entry.knex.raw(selectDef.sql);
    const rows = extractRows(rawResult, dbType);

    if (mode === 'preview') {
      return { stage, candidates: rows.length, duration: Date.now() - start };
    }

    // apply
    const isActiveVal = dbType === 'postgresql' ? true : 1;
    let applied = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const srcSchema = String(row['source_schema'] ?? '');
        const srcTable = String(row['source_table'] ?? '');
        const srcCol = String(row['source_column'] ?? '');
        const tgtSchema = String(row['target_schema'] ?? '');
        const tgtTable = String(row['target_table'] ?? '');
        const tgtCol = String(row['target_column'] ?? '');
        const relType = String(row['relationship_type'] ?? 'MANY_TO_ONE');
        const joinHint = String(row['join_hint'] ?? 'LEFT');

        if (!srcSchema || !srcTable || !srcCol || !tgtSchema || !tgtTable || !tgtCol) {
          skipped++;
          continue;
        }

        let bindings: unknown[];
        if (dbType === 'oracle') {
          // resolveDescriptionBind: {{DESCRIPTION_BIND}} → ?
          const mergedSql = upsertDef.sql.replace(/\{\{DESCRIPTION_BIND\}\}/g, '?');
          bindings = [
            srcSchema, srcTable, srcCol, tgtSchema, tgtTable, tgtCol,
            relType, 'HIGH', joinHint, null, isActiveVal, 'auto_import',
          ];
          await entry.knex.raw(mergedSql, bindings);
        } else {
          bindings = [
            srcSchema, srcTable, srcCol, tgtSchema, tgtTable, tgtCol,
            relType, 'HIGH', joinHint, null, isActiveVal, 'auto_import',
          ];
          await entry.knex.raw(upsertDef.sql, bindings);
        }
        applied++;
      } catch {
        skipped++;
      }
    }

    return {
      stage,
      candidates: rows.length,
      applied,
      skipped,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      stage,
      candidates: 0,
      error: maskSensitiveInfo(err instanceof Error ? err.message : String(err)),
      duration: Date.now() - start,
    };
  }
}

// ============================================================================
// Stage 2: 코드테이블 휴리스틱 탐지
// ============================================================================

async function runCodeTableDetection(
  entry: ConnectionEntry,
  mode: 'preview' | 'apply'
): Promise<StageResult> {
  const start = Date.now();
  const stage: AutoSetupStage = 'code_table_detection';
  const dbType = entry.params.type;
  const config = loadMetadataQueries(dbType);

  const selectDef = config.queries.autoImportCodeTableSelect;
  const upsertDef = config.queries.codeTableUpsert;
  if (!selectDef || !upsertDef) {
    return { stage, candidates: 0, error: `Required SQL not defined for ${dbType}` };
  }

  try {
    const rawResult = await entry.knex.raw(selectDef.sql);
    const rows = extractRows(rawResult, dbType);

    if (mode === 'preview') {
      return { stage, candidates: rows.length, duration: Date.now() - start };
    }

    // apply: is_active = FALSE (requires human review)
    const charset = entry.params.oracleDataCharset;
    let applied = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const tableSchema = String(row['table_schema'] ?? '');
        const tableName = String(row['table_name'] ?? '');
        if (!tableSchema || !tableName) { skipped++; continue; }

        const codeTableName = `${tableSchema}.${tableName}`;
        const codeCol = row['guessed_code_col'] ? String(row['guessed_code_col']) : 'code';
        const nameCol = row['guessed_name_col'] ? String(row['guessed_name_col']) : 'name';
        const groupCol = row['guessed_group_col'] ? String(row['guessed_group_col']) : null;
        const sortCol = row['guessed_sort_col'] ? String(row['guessed_sort_col']) : null;
        const activeCol = row['guessed_active_col'] ? String(row['guessed_active_col']) : null;
        const isActiveVal = dbType === 'postgresql' ? false : 0; // requires review

        if (dbType === 'oracle') {
          const mergedSql = resolveOracleTextBind(upsertDef.sql, charset);
          await entry.knex.raw(mergedSql, [
            // ON
            codeTableName,
            // MATCHED SET (11)
            tableSchema, tableName, groupCol, codeCol, nameCol,
            null, sortCol, activeCol, null, isActiveVal, null,
            // NOT MATCHED INSERT (12)
            codeTableName, tableSchema, tableName, groupCol, codeCol, nameCol,
            null, sortCol, activeCol, null, isActiveVal, null,
          ]);
        } else {
          await entry.knex.raw(upsertDef.sql, [
            codeTableName, tableSchema, tableName, groupCol, codeCol, nameCol,
            null, sortCol, activeCol, null, isActiveVal, null,
          ]);
        }
        applied++;
      } catch {
        skipped++;
      }
    }

    return { stage, candidates: rows.length, applied, skipped, duration: Date.now() - start };
  } catch (err) {
    return {
      stage,
      candidates: 0,
      error: maskSensitiveInfo(err instanceof Error ? err.message : String(err)),
      duration: Date.now() - start,
    };
  }
}

// ============================================================================
// Stage 3: FK→코드테이블 매핑 탐지
// ============================================================================

async function runCodeMappingDetection(
  entry: ConnectionEntry,
  mode: 'preview' | 'apply'
): Promise<StageResult> {
  const start = Date.now();
  const stage: AutoSetupStage = 'code_mapping_detection';
  const dbType = entry.params.type;
  const config = loadMetadataQueries(dbType);

  const selectDef = config.queries.autoImportCodeMappingSelect;
  const upsertDef = config.queries.columnCodeMappingUpsert;
  if (!selectDef || !upsertDef) {
    return { stage, candidates: 0, error: `Required SQL not defined for ${dbType}` };
  }

  try {
    const rawResult = await entry.knex.raw(selectDef.sql);
    const rows = extractRows(rawResult, dbType);

    if (mode === 'preview') {
      return { stage, candidates: rows.length, duration: Date.now() - start };
    }

    const charset = entry.params.oracleDataCharset;
    const includeInPromptVal = dbType === 'postgresql' ? true : 1;
    const isActiveVal = dbType === 'postgresql' ? true : 1;
    let applied = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const tgtSchema = String(row['source_schema'] ?? '');
        const tgtTable = String(row['source_table'] ?? '');
        const tgtCol = String(row['source_column'] ?? '');
        const codeTableName = String(row['code_table_name'] ?? '');
        if (!tgtSchema || !tgtTable || !tgtCol || !codeTableName) { skipped++; continue; }

        if (dbType === 'oracle') {
          const mergedSql = resolveOracleTextBind(upsertDef.sql, charset);
          await entry.knex.raw(mergedSql, [
            // ON
            tgtSchema, tgtTable, tgtCol,
            // MATCHED SET
            codeTableName, null, null, includeInPromptVal, isActiveVal, null,
            // NOT MATCHED INSERT
            tgtSchema, tgtTable, tgtCol, codeTableName, null, null,
            includeInPromptVal, isActiveVal, null,
          ]);
        } else {
          await entry.knex.raw(upsertDef.sql, [
            tgtSchema, tgtTable, tgtCol, codeTableName,
            null, null, includeInPromptVal, isActiveVal, null,
          ]);
        }
        applied++;
      } catch {
        skipped++;
      }
    }

    return { stage, candidates: rows.length, applied, skipped, duration: Date.now() - start };
  } catch (err) {
    return {
      stage,
      candidates: 0,
      error: maskSensitiveInfo(err instanceof Error ? err.message : String(err)),
      duration: Date.now() - start,
    };
  }
}

// ============================================================================
// Stage 4: 네이밍 컨벤션 기반 FK 추론
// ============================================================================

async function runNamingConvention(
  entry: ConnectionEntry,
  connManager: ConnectionManager,
  mode: 'preview' | 'apply',
  schema?: string
): Promise<StageResult> {
  const start = Date.now();
  const stage: AutoSetupStage = 'naming_convention';

  try {
    const cache = await connManager.getOrInitCache(entry.connectionId);
    if (!cache) {
      return { stage, candidates: 0, error: 'Cache not available', duration: Date.now() - start };
    }

    const config = buildConfigFromEntry(entry);
    const schemaInfo = await extractSchema(entry.knex, config);

    const candidates = await inferRelationships(
      cache.namingConventions,
      cache.relationships,
      {
        schemaTables: schemaInfo.tables,
        schema,
        types: ['naming_convention'],
      }
    );

    if (mode === 'preview') {
      return { stage, candidates: candidates.length, duration: Date.now() - start };
    }

    const { applied, skipped } = await applyInferredRelationships(
      entry.knex,
      entry.params.type,
      candidates,
      entry.params.oracleDataCharset
    );

    return { stage, candidates: candidates.length, applied, skipped, duration: Date.now() - start };
  } catch (err) {
    return {
      stage,
      candidates: 0,
      error: maskSensitiveInfo(err instanceof Error ? err.message : String(err)),
      duration: Date.now() - start,
    };
  }
}

// ============================================================================
// Stage 5: LLM 기반 FK 추론
// ============================================================================

async function runLLMRelationship(
  entry: ConnectionEntry,
  connManager: ConnectionManager,
  mode: 'preview' | 'apply',
  schema?: string
): Promise<StageResult> {
  const start = Date.now();
  const stage: AutoSetupStage = 'llm_relationship';

  try {
    const cache = await connManager.getOrInitCache(entry.connectionId);
    if (!cache) {
      return { stage, candidates: 0, error: 'Cache not available', duration: Date.now() - start };
    }

    const config = buildConfigFromEntry(entry);
    const aiClient = createAIClient(config);
    const schemaInfo = await extractSchema(entry.knex, config);

    const candidates = await inferRelationships(
      cache.namingConventions,
      cache.relationships,
      {
        schemaTables: schemaInfo.tables,
        schema,
        types: ['column_match'],
        aiProvider: aiClient,
        metadata: cache,
      }
    );

    if (mode === 'preview') {
      return { stage, candidates: candidates.length, duration: Date.now() - start };
    }

    const { applied, skipped } = await applyInferredRelationships(
      entry.knex,
      entry.params.type,
      candidates,
      entry.params.oracleDataCharset
    );

    return { stage, candidates: candidates.length, applied, skipped, duration: Date.now() - start };
  } catch (err) {
    return {
      stage,
      candidates: 0,
      error: maskSensitiveInfo(err instanceof Error ? err.message : String(err)),
      duration: Date.now() - start,
    };
  }
}

// ============================================================================
// Stage 6: 용어집 AI 생성
// ============================================================================

async function runGlossaryGeneration(
  entry: ConnectionEntry,
  connManager: ConnectionManager,
  mode: 'preview' | 'apply'
): Promise<StageResult> {
  const start = Date.now();
  const stage: AutoSetupStage = 'glossary_generation';

  try {
    const cache = await connManager.getOrInitCache(entry.connectionId);
    if (!cache) {
      return { stage, candidates: 0, error: 'Cache not available', duration: Date.now() - start };
    }

    const config = buildConfigFromEntry(entry);
    const aiClient = createAIClient(config);
    const schemaInfo = await extractSchema(entry.knex, config);

    const candidates = await generateGlossaryTerms(aiClient, schemaInfo, cache, entry.params.type);

    if (mode === 'preview') {
      return { stage, candidates: candidates.length, duration: Date.now() - start };
    }

    const applied = await applyGlossaryTerms(
      entry.knex,
      entry.params.type,
      candidates,
      entry.params.oracleDataCharset
    );

    return {
      stage,
      candidates: candidates.length,
      applied,
      skipped: candidates.length - applied,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      stage,
      candidates: 0,
      error: maskSensitiveInfo(err instanceof Error ? err.message : String(err)),
      duration: Date.now() - start,
    };
  }
}

// ============================================================================
// Stage 7: 코드 별칭 AI 생성
// ============================================================================

async function runCodeAliasGeneration(
  entry: ConnectionEntry,
  connManager: ConnectionManager,
  mode: 'preview' | 'apply'
): Promise<StageResult> {
  const start = Date.now();
  const stage: AutoSetupStage = 'code_alias_generation';

  try {
    const cache = await connManager.getOrInitCache(entry.connectionId);
    if (!cache || cache.codeTables.length === 0) {
      return {
        stage,
        candidates: 0,
        error: cache ? undefined : 'Cache not available',
        duration: Date.now() - start,
      };
    }

    const config = buildConfigFromEntry(entry);
    const aiClient = createAIClient(config);

    const candidates = await generateCodeAliases(
      aiClient,
      entry.knex,
      cache.codeTables,
      entry.params.type
    );

    if (mode === 'preview') {
      return { stage, candidates: candidates.length, duration: Date.now() - start };
    }

    const applied = await applyCodeAliases(
      entry.knex,
      entry.params.type,
      candidates,
      entry.params.oracleDataCharset
    );

    return {
      stage,
      candidates: candidates.length,
      applied,
      skipped: candidates.length - applied,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      stage,
      candidates: 0,
      error: maskSensitiveInfo(err instanceof Error ? err.message : String(err)),
      duration: Date.now() - start,
    };
  }
}

// ============================================================================
// Stage 8: 쿼리 패턴 AI 생성
// ============================================================================

async function runPatternGeneration(
  entry: ConnectionEntry,
  connManager: ConnectionManager,
  mode: 'preview' | 'apply'
): Promise<StageResult> {
  const start = Date.now();
  const stage: AutoSetupStage = 'pattern_generation';

  try {
    const cache = await connManager.getOrInitCache(entry.connectionId);
    if (!cache) {
      return { stage, candidates: 0, error: 'Cache not available', duration: Date.now() - start };
    }

    const config = buildConfigFromEntry(entry);
    const aiClient = createAIClient(config);
    const schemaInfo = await extractSchema(entry.knex, config);

    const candidates = await generateQueryPatterns(aiClient, schemaInfo, cache, entry.params.type);

    if (mode === 'preview') {
      return { stage, candidates: candidates.length, duration: Date.now() - start };
    }

    const applied = await applyQueryPatterns(
      entry.knex,
      entry.params.type,
      candidates,
      entry.params.oracleDataCharset
    );

    return {
      stage,
      candidates: candidates.length,
      applied,
      skipped: candidates.length - applied,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      stage,
      candidates: 0,
      error: maskSensitiveInfo(err instanceof Error ? err.message : String(err)),
      duration: Date.now() - start,
    };
  }
}

// ============================================================================
// 메인 함수
// ============================================================================

/**
 * 전체 메타데이터 자동 셋업 도구
 *
 * @param input - 모드/단계 선택 및 연결 ID
 * @param connManager - ConnectionManager 인스턴스
 * @returns 각 stage별 실행 결과
 */
export async function autoSetup(
  input: AutoSetupInput,
  connManager: ConnectionManager
): Promise<AutoSetupOutput> {
  const entry = connManager.resolve(input.connectionId);
  if (!entry) {
    return {
      success: false,
      message: input.connectionId
        ? `Connection '${input.connectionId}' not found. Use db_connect first.`
        : 'No active connection. Use db_connect first.',
      mode: input.mode,
      stages: [],
    };
  }

  const stagesToRun = input.stages ?? [...STAGE_NAMES];
  const stageResults: StageResult[] = [];

  const stageHandlers: Record<AutoSetupStage, () => Promise<StageResult>> = {
    fk_extraction: () => runFKExtraction(entry, input.mode),
    code_table_detection: () => runCodeTableDetection(entry, input.mode),
    code_mapping_detection: () => runCodeMappingDetection(entry, input.mode),
    naming_convention: () => runNamingConvention(entry, connManager, input.mode, input.schema),
    llm_relationship: () => runLLMRelationship(entry, connManager, input.mode, input.schema),
    glossary_generation: () => runGlossaryGeneration(entry, connManager, input.mode),
    code_alias_generation: () => runCodeAliasGeneration(entry, connManager, input.mode),
    pattern_generation: () => runPatternGeneration(entry, connManager, input.mode),
  };

  for (const stageName of stagesToRun) {
    const handler = stageHandlers[stageName];
    if (handler) {
      const result = await handler();
      stageResults.push(result);
    }
  }

  // apply 모드: 모든 stage 완료 후 캐시 1회 무효화
  if (input.mode === 'apply') {
    connManager.invalidateCache(entry.connectionId);
  }

  const totalCandidates = stageResults.reduce((s, r) => s + r.candidates, 0);
  const totalApplied = stageResults.reduce((s, r) => s + (r.applied ?? 0), 0);
  const errors = stageResults.filter((r) => r.error).length;

  const summary =
    input.mode === 'preview'
      ? `Preview complete: ${totalCandidates} candidates across ${stageResults.length} stages`
      : `Applied: ${totalApplied} items across ${stageResults.length} stages${errors > 0 ? ` (${errors} stages had errors)` : ''}`;

  return {
    success: errors === 0 || totalApplied > 0,
    message: summary,
    connectionId: entry.connectionId,
    mode: input.mode,
    stages: stageResults,
  };
}
