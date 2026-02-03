/**
 * SSE 전송 계층
 *
 * @description
 * HTTP 서버를 통한 Server-Sent Events (SSE) 전송을 구현합니다.
 * Bearer 토큰 인증을 지원합니다.
 *
 * @module mcp/transport/sse
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * SSE 서버를 시작합니다.
 *
 * @param mcpServer - MCP 서버 인스턴스
 * @param options - 서버 옵션
 */
export function startSSEServer(
  mcpServer: McpServer,
  options: SSEServerOptions = {}
): void {
  const { port = 3001, authToken, corsOrigin = '*' } = options;

  // SSE 전송 인스턴스 저장소
  let sseTransport: SSEServerTransport | null = null;

  const server = createServer((req, res) => {
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

    // SSE 연결 엔드포인트
    if (url.pathname === '/sse' && req.method === 'GET') {
      console.log('[SSE] Client connected');

      // 새 SSE 전송 인스턴스 생성
      sseTransport = new SSEServerTransport('/message', res);

      // 연결 종료 시 처리
      res.on('close', () => {
        console.log('[SSE] Client disconnected');
        sseTransport = null;
      });

      // MCP 서버와 연결
      mcpServer.connect(sseTransport).catch((error) => {
        console.error('[SSE] Connection error:', error);
      });
      return;
    }

    // 메시지 수신 엔드포인트
    if (url.pathname === '/message' && req.method === 'POST') {
      if (!sseTransport) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active SSE connection' }));
        return;
      }

      // 요청 본문 읽기
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        sseTransport!.handlePostMessage(req, res, body).catch((error) => {
          console.error('[SSE] Message handling error:', error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
      });
      return;
    }

    // 404 Not Found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, () => {
    console.log(`[SSE] NL2SQL MCP server listening on port ${port}`);
    console.log(`[SSE] Endpoints:`);
    console.log(`  - GET  /health  - Health check`);
    console.log(`  - GET  /sse     - SSE connection`);
    console.log(`  - POST /message - Message endpoint`);
    if (authToken) {
      console.log(`[SSE] Authentication: Bearer token required`);
    }
  });

  // 프로세스 종료 시 서버 정리
  process.on('SIGINT', () => {
    console.log('\n[SSE] Shutting down server...');
    server.close(() => {
      console.log('[SSE] Server closed');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\n[SSE] Shutting down server...');
    server.close(() => {
      console.log('[SSE] Server closed');
      process.exit(0);
    });
  });
}
