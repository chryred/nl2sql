/**
 * MCP 서버 설정 및 도구 등록
 *
 * @description
 * McpServer 인스턴스를 생성하고 NL2SQL 도구들을 등록합니다.
 * ConnectionManager를 통해 다중 연결을 지원합니다.
 *
 * @module mcp/server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConnectionManager } from '../database/connection-manager.js';

import { dbConnect, dbConnectInputSchema } from './tools/db-connect.js';
import {
  dbDisconnect,
  dbDisconnectInputSchema,
} from './tools/db-disconnect.js';
import { dbListConnections, dbListInputSchema } from './tools/db-list.js';
import {
  nl2sqlSchema,
  nl2sqlSchemaInputSchema,
} from './tools/nl2sql-schema.js';
import {
  nl2sqlQuery,
  nl2sqlQueryInputSchema,
  formatAsText,
} from './tools/nl2sql-query.js';
import {
  cacheStatus,
  cacheStatusInputSchema,
  cacheRefresh,
  cacheRefreshInputSchema,
} from './tools/cache-manage.js';
import { schemaSetup, schemaSetupInputSchema } from './tools/schema-setup.js';
import {
  inferRelationshipsTool,
  inferRelationshipsInputSchema,
} from './tools/infer-relationships.js';
import {
  queryPatternAdd,
  queryPatternAddInputSchema,
  queryPatternSearch,
  queryPatternSearchInputSchema,
} from './tools/query-pattern-manage.js';
import {
  autoCommentsTool,
  autoCommentsInputSchema,
  formatAutoCommentResult,
} from './tools/auto-comments.js';
import {
  queryHistoryList,
  queryHistoryListInputSchema,
  queryHistorySearch,
  queryHistorySearchInputSchema,
  queryHistoryRegister,
  queryHistoryRegisterInputSchema,
} from './tools/query-history.js';
import {
  glossaryManage,
  glossaryManageInputSchema,
} from './tools/glossary-manage.js';
import {
  codeTableManage,
  codeTableManageInputSchema,
} from './tools/code-table-manage.js';
import {
  relationshipManage,
  relationshipManageInputSchema,
} from './tools/relationship-manage.js';
import {
  namingConventionManage,
  namingConventionManageInputSchema,
} from './tools/naming-convention-manage.js';
import {
  autoSetup,
  autoSetupInputSchema,
} from './tools/auto-setup.js';
import {
  queryFeedback,
  queryFeedbackInputSchema,
} from './tools/query-feedback.js';

/**
 * MCP 서버 인스턴스를 생성하고 도구들을 등록합니다.
 *
 * @param connManager - ConnectionManager 인스턴스
 * @returns 설정된 McpServer 인스턴스
 */
export function createMcpServer(connManager: ConnectionManager): McpServer {
  const server = new McpServer({
    name: 'nl2sql-mcp',
    version: '1.12.0',
  });

  // ─── Phase 1: 연결 설정 ───────────────────────────────────────────────────

  // 1단계: db_connect - 자격증명으로 DB 접속 (connectionId 발급)
  server.registerTool(
    'db_connect',
    {
      description:
        'Connect to a database with provided credentials. Returns connectionId for subsequent tool calls. ' +
        'Ask for parameters in this order: systemName first, then type, host, port, user, password, database.',
      inputSchema: dbConnectInputSchema,
    },
    async (args) => {
      const input = dbConnectInputSchema.parse(args);
      const result = await dbConnect(input, connManager);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 2단계: db_list_connections - 활성 연결 목록 확인
  server.registerTool(
    'db_list_connections',
    {
      description: 'List all active database connections with their status.',
      inputSchema: dbListInputSchema,
    },
    () => {
      const result = dbListConnections(connManager);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ─── Phase 2: 메타데이터 초기 구성 (최초 1회) ────────────────────────────

  // 3단계: schema_setup - NL2SQL 메타 스키마 초기 설정 (최초 1회)
  server.registerTool(
    'schema_setup',
    {
      description:
        'Create NL2SQL metadata tables in the connected database. ' +
        'IMPORTANT: You MUST ask the user for confirmation before calling this tool. ' +
        'Existing tables will be skipped (idempotent). Optionally specify connectionId.',
      inputSchema: schemaSetupInputSchema,
    },
    async (args) => {
      const input = schemaSetupInputSchema.parse(args);
      const result = await schemaSetup(input, connManager);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 4단계: auto_setup - 전체 메타데이터 자동 셋업 (schema_setup 이후 실행)
  server.registerTool(
    'auto_setup',
    {
      description:
        'Automatically populate ALL NL2SQL metadata from the current database schema. ' +
        'Runs up to 8 stages: FK extraction, code table detection, code mapping detection, ' +
        'naming convention inference, LLM FK inference, AI glossary generation, ' +
        'AI code alias generation, and AI query pattern generation. ' +
        'Use mode=preview to see candidate counts without DB changes. ' +
        'Use mode=apply to execute all stages and refresh cache. ' +
        'Optionally specify stages[] to run only specific stages. Optionally specify connectionId.',
      inputSchema: autoSetupInputSchema,
    },
    async (args) => {
      const input = autoSetupInputSchema.parse(args);
      const result = await autoSetup(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ─── Phase 3: 개별 메타데이터 관리 ──────────────────────────────────────

  // 5단계: glossary_manage - 비즈니스 용어집 CRUD 관리
  server.registerTool(
    'glossary_manage',
    {
      description:
        'Manage business glossary terms (add/update/deactivate/list). ' +
        'Glossary terms map natural language phrases to SQL conditions, improving query accuracy. ' +
        'Use action=add to register a new term, action=list to view all active terms. ' +
        'Supports aliases and table-specific context overrides. Optionally specify connectionId.',
      inputSchema: glossaryManageInputSchema,
    },
    async (args) => {
      const input = glossaryManageInputSchema.parse(args);
      const result = await glossaryManage(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 6단계: code_table_manage - 코드테이블 CRUD 관리
  server.registerTool(
    'code_table_manage',
    {
      description:
        'Manage code tables and column-code mappings (add/activate/deactivate/add_mapping/add_alias/list). ' +
        'Code tables store categorical values (e.g., status codes). ' +
        'Use action=add to register a code table, action=add_mapping to map a column to a code table. ' +
        'Use action=list to view current code tables and mappings. Optionally specify connectionId.',
      inputSchema: codeTableManageInputSchema,
    },
    async (args) => {
      const input = codeTableManageInputSchema.parse(args);
      const result = await codeTableManage(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 7단계: relationship_manage - 테이블 관계 CRUD 관리
  server.registerTool(
    'relationship_manage',
    {
      description:
        'Manage table relationships / FK associations (add/activate/deactivate/list). ' +
        'Use action=add to register a relationship between two columns, ' +
        'action=activate/deactivate to toggle is_active, action=list to view all relationships. ' +
        'Requires source and target schema/table/column. Optionally specify connectionId.',
      inputSchema: relationshipManageInputSchema,
    },
    async (args) => {
      const input = relationshipManageInputSchema.parse(args);
      const result = await relationshipManage(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 8단계: naming_convention_manage - 네이밍 컨벤션 CRUD 관리
  server.registerTool(
    'naming_convention_manage',
    {
      description:
        'Manage naming convention rules for FK inference (add/update/deactivate/list). ' +
        'Naming conventions help infer FK relationships from column name patterns (e.g., *_id → related table). ' +
        'Use action=add to register a pattern, action=list to view active conventions. ' +
        'Optionally specify connectionId.',
      inputSchema: namingConventionManageInputSchema,
    },
    async (args) => {
      const input = namingConventionManageInputSchema.parse(args);
      const result = await namingConventionManage(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 9단계: infer_relationships - 네이밍 패턴/컬럼명 기반 FK 관계 추론
  server.registerTool(
    'infer_relationships',
    {
      description:
        'Infer FK relationships from naming conventions and column name matching. ' +
        'Use mode=preview to see candidates, mode=apply to insert into table_relationships. ' +
        'naming_convention type produces MEDIUM confidence (auto-active), ' +
        'column_match type uses LLM-based inference (HIGH/MEDIUM/LOW confidence, auto-active).',
      inputSchema: inferRelationshipsInputSchema,
    },
    async (args) => {
      const input = inferRelationshipsInputSchema.parse(args);
      const result = await inferRelationshipsTool(input, connManager);

      const text = JSON.stringify(result, null, 2);

      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
      };
    }
  );

  // 10단계: auto_generate_comments - 미설정 테이블/컬럼 코멘트 자동 생성
  server.registerTool(
    'auto_generate_comments',
    {
      description:
        'Automatically generate comments for tables and columns that have no comment set. ' +
        'Uses AI to infer comments from physical names, data types, and metadata context. ' +
        'Use mode=preview to see candidates without writing to DB, mode=apply to write comments. ' +
        'Existing comments are never overwritten. Optionally specify connectionId, schema, or tables.',
      inputSchema: autoCommentsInputSchema,
    },
    async (args) => {
      const input = autoCommentsInputSchema.parse(args);
      const result = await autoCommentsTool(input, connManager);

      const text = result.result
        ? formatAutoCommentResult(result.result) +
          '\n\n' +
          JSON.stringify(
            { success: result.success, message: result.message },
            null,
            2
          )
        : JSON.stringify(result, null, 2);

      return {
        content: [{ type: 'text' as const, text }],
      };
    }
  );

  // 11단계: query_pattern_add - 자주 사용하는 쿼리 패턴 등록
  server.registerTool(
    'query_pattern_add',
    {
      description:
        'Register a frequently used query pattern into the database. ' +
        'The pattern will be available as hints for future SQL generation. ' +
        'Cache is automatically invalidated after registration. ' +
        'Optionally specify connectionId.',
      inputSchema: queryPatternAddInputSchema,
    },
    async (args) => {
      const input = queryPatternAddInputSchema.parse(args);
      const result = await queryPatternAdd(input, connManager);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // 12단계: query_pattern_search - 쿼리 패턴 키워드 검색
  server.registerTool(
    'query_pattern_search',
    {
      description:
        'Search registered query patterns by keyword (matches patternName or description). ' +
        'Returns matching patterns with their SQL templates and keywords. ' +
        'Optionally specify connectionId.',
      inputSchema: queryPatternSearchInputSchema,
    },
    async (args) => {
      const input = queryPatternSearchInputSchema.parse(args);
      const result = await queryPatternSearch(input, connManager);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // ─── Phase 4: 캐시 관리 ──────────────────────────────────────────────────

  // 13단계: cache_status - 메타데이터 캐시 상태 확인
  server.registerTool(
    'cache_status',
    {
      description:
        'Get metadata cache status including initialization state and item counts. Optionally specify connectionId.',
      inputSchema: cacheStatusInputSchema,
    },
    (args) => {
      const input = cacheStatusInputSchema.parse(args);
      const result = cacheStatus(input, connManager);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 14단계: cache_refresh - 메타데이터 캐시 새로고침 (Docker 재기동 불필요)
  server.registerTool(
    'cache_refresh',
    {
      description:
        'Refresh metadata cache without Docker restart. Optionally specify connectionId.',
      inputSchema: cacheRefreshInputSchema,
    },
    async (args) => {
      const input = cacheRefreshInputSchema.parse(args);
      const result = await cacheRefresh(input, connManager);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ─── Phase 5: 핵심 쿼리 도구 ─────────────────────────────────────────────

  // 15단계: nl2sql_schema - DB 스키마 정보 조회
  server.registerTool(
    'nl2sql_schema',
    {
      description:
        'Use ONLY when the user explicitly wants to inspect table structure or column definitions ' +
        '(e.g., "show me the schema of table X", "what columns does Y have?"). ' +
        'Do NOT call this before nl2sql_query — nl2sql_query handles schema lookup internally. ' +
        'Requires a list of table names (case-insensitive) to avoid fetching all tables. ' +
        'Supports json, prompt, and summary formats. Optionally specify connectionId.',
      inputSchema: nl2sqlSchemaInputSchema,
    },
    async (args) => {
      const input = nl2sqlSchemaInputSchema.parse(args);
      const result = await nl2sqlSchema(input, connManager);

      // prompt 형식은 텍스트로, 나머지는 JSON으로
      const text =
        input.format === 'prompt' && typeof result.data === 'string'
          ? result.data
          : JSON.stringify(result, null, 2);

      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
      };
    }
  );

  // 16단계: nl2sql_query - 자연어 → SQL 변환 및 실행
  server.registerTool(
    'nl2sql_query',
    {
      description:
        'PRIMARY tool for ALL natural language database queries. ' +
        'Handles schema lookup, SQL generation, and optional execution internally — no pre-schema fetch needed. ' +
        'Use this whenever the user asks anything about the data in natural language ' +
        '(e.g., "show me...", "find...", "count...", "list all..."). ' +
        'Set execute=true to run immediately, execute=false to preview SQL only. ' +
        'Optionally specify connectionId.',
      inputSchema: nl2sqlQueryInputSchema,
    },
    async (args) => {
      const input = nl2sqlQueryInputSchema.parse(args);
      const result = await nl2sqlQuery(input, connManager);

      const text =
        input.format === 'text'
          ? formatAsText(result)
          : JSON.stringify(result, null, 2);

      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
      };
    }
  );

  // ─── Phase 6: 쿼리 이력 및 피드백 ───────────────────────────────────────

  // 17단계: query_history_list - 쿼리 이력 목록 조회
  server.registerTool(
    'query_history_list',
    {
      description:
        'List nl2sql_query execution history. ' +
        'Use sortBy=recent (default) for latest queries or sortBy=frequent for most-used queries. ' +
        'Requires query_history table (run schema_setup first). Optionally specify connectionId.',
      inputSchema: queryHistoryListInputSchema,
    },
    async (args) => {
      const input = queryHistoryListInputSchema.parse(args);
      const result = await queryHistoryList(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 18단계: query_history_search - 쿼리 이력 키워드 검색
  server.registerTool(
    'query_history_search',
    {
      description:
        'Search nl2sql_query execution history by keyword. ' +
        'Matches against natural language query text. ' +
        'Results sorted by usage_count DESC. Optionally specify connectionId.',
      inputSchema: queryHistorySearchInputSchema,
    },
    async (args) => {
      const input = queryHistorySearchInputSchema.parse(args);
      const result = await queryHistorySearch(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 19단계: query_history_register - 이력 → query_patterns 승격 (북마크)
  server.registerTool(
    'query_history_register',
    {
      description:
        'Promote a history entry to query_patterns (bookmark). ' +
        'The generated SQL becomes a reusable pattern that the AI will use as a hint for future queries. ' +
        'Cache is automatically invalidated. Optionally specify connectionId.',
      inputSchema: queryHistoryRegisterInputSchema,
    },
    async (args) => {
      const input = queryHistoryRegisterInputSchema.parse(args);
      const result = await queryHistoryRegister(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 20단계: query_feedback - 쿼리 피드백 기반 메타데이터 자동 개선
  server.registerTool(
    'query_feedback',
    {
      description:
        'Improve NL2SQL metadata based on user feedback about query results. ' +
        'Provide the original query, generated SQL, and either a corrected SQL or natural language feedback. ' +
        'Use mode=preview to see suggested metadata improvements without applying. ' +
        'Use mode=apply to automatically apply improvements (glossary terms, FK relationships). ' +
        'Other suggestions (code tables, query patterns) are returned for manual application. ' +
        'Optionally specify connectionId.',
      inputSchema: queryFeedbackInputSchema,
    },
    async (args) => {
      const input = queryFeedbackInputSchema.parse(args);
      const result = await queryFeedback(input, connManager);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ─── Phase 7: 연결 해제 ──────────────────────────────────────────────────

  // 21단계: db_disconnect - 연결 해제 및 리소스 반환
  server.registerTool(
    'db_disconnect',
    {
      description:
        'Disconnect a registered database connection and release resources.',
      inputSchema: dbDisconnectInputSchema,
    },
    async (args) => {
      const input = dbDisconnectInputSchema.parse(args);
      const result = await dbDisconnect(input, connManager);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
