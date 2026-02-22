import { z } from 'zod';
import type { ConnectionManager } from '../../database/connection-manager.js';
import {
  filterMissingComments,
  buildCommentPrompt,
  batchTargets,
  parseCommentResponse,
  truncateComment,
  applyComments,
  COMMENT_SYSTEM_PROMPT,
  type AutoCommentResult,
  type CommentCandidate,
} from '../../database/comment-generator.js';
import { buildConfigFromEntry } from '../utils/config-helper.js';
import { createAIClient } from '../../ai/client-factory.js';
import { maskSensitiveInfo } from '../../errors/index.js';
import { extractSchema } from '../../database/schema-extractor.js';

export const autoCommentsInputSchema = z.object({
  connectionId: z
    .string()
    .optional()
    .describe('Connection ID (optional, uses default if omitted)'),
  mode: z
    .enum(['preview', 'apply'])
    .describe(
      'preview: show comment candidates without writing to DB, apply: write comments to DB'
    ),
  schema: z
    .string()
    .optional()
    .describe('Filter to specific schema (optional)'),
  tables: z
    .array(z.string())
    .optional()
    .describe('Filter to specific tables (optional)'),
});

export type AutoCommentsInput = z.infer<typeof autoCommentsInputSchema>;

export interface AutoCommentsOutput {
  success: boolean;
  message: string;
  connectionId?: string;
  result?: AutoCommentResult;
  error?: string;
}

export async function autoCommentsTool(
  input: AutoCommentsInput,
  connManager: ConnectionManager
): Promise<AutoCommentsOutput> {
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
    const config = buildConfigFromEntry(entry);
    const aiClient = createAIClient(config);
    const cache = await connManager.getOrInitCache(entry.connectionId);
    const dbType = entry.params.type;

    const schema = await extractSchema(entry.knex, config);
    const targets = filterMissingComments(schema, {
      schema: input.schema,
      tables: input.tables,
    });

    if (targets.length === 0) {
      return {
        success: true,
        message: 'No missing comments found',
        connectionId: entry.connectionId,
        result: { candidates: [] },
      };
    }

    const batches = batchTargets(targets);
    const allCandidates: CommentCandidate[] = [];

    for (const batch of batches) {
      const userPrompt = buildCommentPrompt(batch, cache, dbType);
      let response: string;
      try {
        response = await aiClient.generate(COMMENT_SYSTEM_PROMPT, userPrompt);
      } catch (e) {
        continue;
      }
      const generated = parseCommentResponse(response);
      for (const g of generated) {
        const isTable = g.column == null || g.column === '';
        const { text, truncated } = truncateComment(g.comment, dbType, isTable);
        allCandidates.push({ ...g, comment: text, truncated });
      }
    }

    if (input.mode === 'preview') {
      return {
        success: true,
        message: `Found ${allCandidates.length} comment candidates`,
        connectionId: entry.connectionId,
        result: { candidates: allCandidates },
      };
    }

    if (allCandidates.length === 0) {
      return {
        success: true,
        message: 'No comment candidates generated',
        connectionId: entry.connectionId,
        result: { candidates: [], applied: 0, skipped: 0, failed: 0 },
      };
    }

    const { applied, skipped, failed } = await applyComments(
      entry.knex,
      dbType,
      allCandidates,
      entry.params.oracleDataCharset
    );

    if (applied > 0) {
      connManager.invalidateCache(entry.connectionId);
    }

    return {
      success: true,
      message: `Applied ${applied} comments, skipped ${skipped}, failed ${failed}`,
      connectionId: entry.connectionId,
      result: { candidates: allCandidates, applied, skipped, failed },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: 'Failed to generate comments',
      connectionId: entry.connectionId,
      error: maskSensitiveInfo(msg),
    };
  }
}

export function formatAutoCommentResult(result: AutoCommentResult): string {
  const lines: string[] = [];

  if (result.candidates.length === 0) {
    return 'No comment candidates found.';
  }

  const tableCandidates = result.candidates.filter(
    (c) => c.column == null || c.column === ''
  );
  const columnCandidates = result.candidates.filter(
    (c) => c.column != null && c.column !== ''
  );

  if (tableCandidates.length > 0) {
    lines.push(`\n## Table Comments (${tableCandidates.length} candidates)`);
    for (const c of tableCandidates) {
      const truncTag = c.truncated ? ' [TRUNCATED]' : '';
      lines.push(`  ${c.schema}.${c.table} → "${c.comment}"${truncTag}`);
    }
  }

  if (columnCandidates.length > 0) {
    lines.push(`\n## Column Comments (${columnCandidates.length} candidates)`);
    for (const c of columnCandidates) {
      const truncTag = c.truncated ? ' [TRUNCATED]' : '';
      lines.push(
        `  ${c.schema}.${c.table}.${c.column} → "${c.comment}"${truncTag}`
      );
    }
  }

  if (result.applied !== undefined) {
    lines.push(
      `\nApplied: ${result.applied}, Skipped: ${result.skipped ?? 0}, Failed: ${result.failed ?? 0}`
    );
  }

  return lines.join('\n');
}
