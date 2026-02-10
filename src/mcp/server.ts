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
import {
  schemaSetup,
  schemaSetupInputSchema,
} from './tools/schema-setup.js';

/**
 * MCP 서버 인스턴스를 생성하고 도구들을 등록합니다.
 *
 * @param connManager - ConnectionManager 인스턴스
 * @returns 설정된 McpServer 인스턴스
 */
export function createMcpServer(connManager: ConnectionManager): McpServer {
  const server = new McpServer({
    name: 'nl2sql-mcp',
    version: '1.2.0',
  });

  // db_test_connection 도구 등록 (환경변수 기반, 변경 없음)
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

  // db_connect 도구 등록 (연결 등록 + connectionId 반환)
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

  // db_disconnect 도구 등록
  server.registerTool(
    'db_disconnect',
    {
      description: 'Disconnect a registered database connection and release resources.',
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

  // db_list_connections 도구 등록
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

  // nl2sql_schema 도구 등록
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

  // nl2sql_query 도구 등록
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

  // cache_status 도구 등록
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

  // cache_refresh 도구 등록
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

  // schema_setup 도구 등록
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

  return server;
}
