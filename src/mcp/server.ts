/**
 * MCP 서버 설정 및 도구 등록
 *
 * @description
 * McpServer 인스턴스를 생성하고 NL2SQL 도구들을 등록합니다.
 * stdio 및 SSE 전송을 모두 지원합니다.
 *
 * @module mcp/server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { dbTestConnection, dbTestInputSchema } from './tools/db-test.js';
import { dbConnect, dbConnectInputSchema } from './tools/db-connect.js';
import { nl2sqlSchema, nl2sqlSchemaInputSchema } from './tools/nl2sql-schema.js';
import { nl2sqlQuery, nl2sqlQueryInputSchema, formatAsText } from './tools/nl2sql-query.js';

/**
 * MCP 서버 인스턴스를 생성하고 도구들을 등록합니다.
 *
 * @returns 설정된 McpServer 인스턴스
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'nl2sql-mcp',
    version: '1.0.0',
  });

  // db_test_connection 도구 등록
  server.tool(
    'db_test_connection',
    'Test database connection using environment variables. No parameters required.',
    dbTestInputSchema.shape,
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

  // db_connect 도구 등록
  server.tool(
    'db_connect',
    'Test database connection with provided credentials.',
    dbConnectInputSchema.shape,
    async (args) => {
      const input = dbConnectInputSchema.parse(args);
      const result = await dbConnect(input);
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
  server.tool(
    'nl2sql_schema',
    'Get database schema information. Supports json, prompt, and summary formats.',
    nl2sqlSchemaInputSchema.shape,
    async (args) => {
      const input = nl2sqlSchemaInputSchema.parse(args);
      const result = await nl2sqlSchema(input);

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
  server.tool(
    'nl2sql_query',
    'Convert natural language to SQL and optionally execute it.',
    nl2sqlQueryInputSchema.shape,
    async (args) => {
      const input = nl2sqlQueryInputSchema.parse(args);
      const result = await nl2sqlQuery(input);

      const text = input.format === 'text' ? formatAsText(result) : JSON.stringify(result, null, 2);

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

  return server;
}
