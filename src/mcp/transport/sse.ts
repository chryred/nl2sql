/**
 * Streamable HTTP 전송 계층
 *
 * @description
 * HTTP 서버를 통한 Streamable HTTP 전송을 구현합니다.
 * Bearer 토큰 인증을 지원합니다.
 *
 * @module mcp/transport/sse
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * SSE 서버 옵션
 */
export interface SSEServerOptions {
  /** 서버 포트 (기본값: 3001) */
  port?: number;
  /** Bearer 인증 토큰 (설정 시 인증 필수) */
  authToken?: string;
  /** CORS 허용 도메인 (기본값: '*') */
  corsOrigin?: string;
}

/**
 * 요청을 인증합니다.
 */
function authenticateRequest(req: IncomingMessage, authToken?: string): boolean {
  if (!authToken) {
    return true; // 토큰이 설정되지 않으면 인증 통과
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return false;
  }

  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer' || token !== authToken) {
    return false;
  }

  return true;
}

/**
 * CORS 헤더를 설정합니다.
 */
function setCorsHeaders(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

/**
 * Streamable HTTP 서버를 시작합니다.
 *
 * @param mcpServer - MCP 서버 인스턴스
 * @param options - 서버 옵션
 */
export function startSSEServer(
  mcpServer: McpServer,
  options: SSEServerOptions = {}
): void {
  const { port = 3001, authToken, corsOrigin = '*' } = options;

  // Streamable HTTP 전송 인스턴스 저장소
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // CORS 헤더 설정
    setCorsHeaders(res, corsOrigin);

    // OPTIONS 요청 처리 (CORS preflight)
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 헬스체크 엔드포인트
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }

    // 인증 확인
    if (!authenticateRequest(req, authToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // MCP 엔드포인트 (Streamable HTTP)
    if (url.pathname === '/mcp') {
      try {
        // 세션 ID 확인
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && transports.has(sessionId)) {
          // 기존 세션 사용
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
        } else if (req.method === 'POST') {
          // 새 세션 생성 (초기화 요청)
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });

          // 연결 종료 시 세션 정리
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) {
              console.log(`[MCP] Session closed: ${sid}`);
              transports.delete(sid);
            }
          };

          // MCP 서버와 연결
          await mcpServer.connect(transport);

          // 요청 처리
          await transport.handleRequest(req, res);

          // 세션 저장
          const newSessionId = transport.sessionId;
          if (newSessionId) {
            transports.set(newSessionId, transport);
            console.log(`[MCP] New session: ${newSessionId}`);
          }
        } else {
          // GET 요청이지만 세션이 없는 경우
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session ID required for GET requests' }));
        }
      } catch (error) {
        console.error('[MCP] Request handling error:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
      return;
    }

    // 404 Not Found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, () => {
    console.log(`[MCP] NL2SQL MCP server listening on port ${port}`);
    console.log(`[MCP] Endpoints:`);
    console.log(`  - GET  /health  - Health check`);
    console.log(`  - POST /mcp     - MCP endpoint (initialize session)`);
    console.log(`  - GET  /mcp     - MCP endpoint (SSE stream, requires session)`);
    if (authToken) {
      console.log(`[MCP] Authentication: Bearer token required`);
    }
  });

  // 프로세스 종료 시 서버 정리
  const cleanup = () => {
    console.log('\n[MCP] Shutting down server...');

    // 모든 세션 종료
    for (const [sessionId, transport] of transports) {
      console.log(`[MCP] Closing session: ${sessionId}`);
      transport.close().catch(console.error);
    }
    transports.clear();

    server.close(() => {
      console.log('[MCP] Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
