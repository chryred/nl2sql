#!/usr/bin/env node
/**
 * MCP 서버 진입점
 *
 * @description
 * NL2SQL MCP 서버의 메인 진입점입니다.
 * ConnectionManager를 생성하고 환경변수에 따라 stdio 또는 SSE 전송을 선택합니다.
 *
 * @environment
 * - MCP_TRANSPORT: 전송 방식 (stdio | sse, 기본값: stdio)
 * - MCP_PORT: SSE 서버 포트 (기본값: 3001)
 * - MCP_AUTH_TOKEN: SSE Bearer 인증 토큰 (선택)
 *
 * @module mcp
 *
 * @example
 * // stdio 모드로 실행
 * node dist/mcp/index.js
 *
 * // SSE 모드로 실행
 * MCP_TRANSPORT=sse MCP_PORT=3001 node dist/mcp/index.js
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { startSSEServer } from './transport/sse.js';
import { ConnectionManager } from '../database/connection-manager.js';
import { getConfig, validateConfig } from '../config/index.js';

/**
 * MCP 서버를 시작합니다.
 */
async function main(): Promise<void> {
  const transport = process.env.MCP_TRANSPORT || 'stdio';
  const port = parseInt(process.env.MCP_PORT || '3001', 10);
  const authToken = process.env.MCP_AUTH_TOKEN;

  // ConnectionManager 생성
  const connManager = new ConnectionManager({
    maxConnections: 10,
    idleTtlMs: 30 * 60 * 1000,
  });

  // 환경변수에 DB 설정이 있으면 기본 연결 자동 등록
  try {
    const config = getConfig();
    validateConfig(config);
    connManager.registerDefault({
      type: config.database.type,
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      serviceName: config.database.serviceName,
    });
  } catch {
    console.log(
      '[MCP] No default connection registered (environment variables not configured or invalid)'
    );
  }

  const server = createMcpServer(connManager);

  if (transport === 'sse') {
    console.log('[MCP] Starting NL2SQL MCP server in SSE mode');
    startSSEServer(server, { port, authToken });
  } else {
    console.log('[MCP] Starting NL2SQL MCP server in stdio mode');
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.log('[MCP] Server connected via stdio');
  }

  // 종료 시 정리
  const cleanup = () => {
    connManager.destroyAll().then(() => {
      process.exit(0);
    }).catch(() => {
      process.exit(1);
    });
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
