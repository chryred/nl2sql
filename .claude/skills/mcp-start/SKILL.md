---
name: mcp-start
description: Start MCP server in specified mode
user-invocable: true
args: mode (stdio|sse)
---

# Start MCP Server

MCP 서버를 지정된 모드로 시작합니다.

## Instructions

### 1. 빌드 확인
```bash
npm run build
```

### 2. 서버 시작

**stdio 모드** (Claude Desktop 연동):
```bash
npm run start:mcp
```

**SSE 모드** (HTTP 웹 클라이언트):
```bash
npm run start:mcp:sse
```

### 3. SSE 모드 환경변수

SSE 모드 사용 시 다음 환경변수를 설정할 수 있습니다:
- `MCP_PORT`: 서버 포트 (기본값: 3001)
- `MCP_AUTH_TOKEN`: Bearer 인증 토큰

### 4. 헬스체크

SSE 모드에서 서버 상태 확인:
```bash
curl http://localhost:3001/health
```

## Claude Desktop 설정

`claude_desktop_config.json`에 추가:
```json
{
  "mcpServers": {
    "nl2sql": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "cwd": "/path/to/nl2sql_ts"
    }
  }
}
```
