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

import { dbTestConnection, dbTestInputSchema } from './tools/db-test.js';
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
  formatInferenceResult,
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

/**
 * MCP 서버 인스턴스를 생성하고 도구들을 등록합니다.
 *
 * @param connManager - ConnectionManager 인스턴스
 * @returns 설정된 McpServer 인스턴스
 */
export function createMcpServer(connManager: ConnectionManager): McpServer {
  const server = new McpServer({
    name: 'nl2sql-mcp',
    version: '1.5.0',
  });

  // 1단계: db_test_connection - 환경변수 기반 연결 테스트
  server.registerTool(
    'db_test_connection',
    {
      description:
        'Test database connection using environment variables. No parameters required.',
      inputSchema: dbTestInputSchema,
    },
    async () => {
      const result = await dbTestConnection();
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

  // 2단계: db_connect - 자격증명으로 DB 접속 (connectionId 발급)
  server.registerTool(
    'db_connect',
    {
      description:
        'Connect to a database with provided credentials. Returns connectionId for subsequent tool calls.',
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

  // 3단계: db_list_connections - 활성 연결 목록 확인
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

  // 4단계: schema_setup - NL2SQL 메타 스키마 초기 설정 (최초 1회)
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

  // 5단계: cache_status - 메타데이터 캐시 상태 확인
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

  // 6단계: cache_refresh - 메타데이터 캐시 새로고침 (Docker 재기동 불필요)
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

  // 7단계: infer_relationships - 네이밍 패턴/컬럼명 기반 FK 관계 추론
  server.registerTool(
    'infer_relationships',
    {
      description:
        'Infer FK relationships from naming conventions and column name matching. ' +
        'Use mode=preview to see candidates, mode=apply to insert into table_relationships. ' +
        'naming_convention type produces MEDIUM confidence (auto-active), ' +
        'column_match type produces LOW confidence (manual review needed).',
      inputSchema: inferRelationshipsInputSchema,
    },
    async (args) => {
      const input = inferRelationshipsInputSchema.parse(args);
      const result = await inferRelationshipsTool(input, connManager);

      const text = result.result
        ? formatInferenceResult(result.result) +
          '\n\n' +
          JSON.stringify(
            { success: result.success, message: result.message },
            null,
            2
          )
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

  // 8단계: query_pattern_add - 자주 사용하는 쿼리 패턴 등록
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

  // 9단계: query_pattern_search - 쿼리 패턴 키워드 검색
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

  // 11단계: nl2sql_schema - DB 스키마 정보 조회
  server.registerTool(
    'nl2sql_schema',
    {
      description:
        'Get database schema information. Supports json, prompt, and summary formats. Optionally specify connectionId.',
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

  // 12단계: nl2sql_query - 자연어 → SQL 변환 및 실행
  server.registerTool(
    'nl2sql_query',
    {
      description:
        'Convert natural language to SQL and optionally execute it. Optionally specify connectionId.',
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

  // 13단계: query_history_list - 쿼리 이력 목록 조회
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

  // 14단계: query_history_search - 쿼리 이력 키워드 검색
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

  // 15단계: query_history_register - 이력 → query_patterns 승격 (북마크)
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

  // 16단계: db_disconnect - 연결 해제 및 리소스 반환
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
