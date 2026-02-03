---
description: MCP server development rules
globs: ["src/mcp/**"]
---

# MCP Server Guide

Model Context Protocol 서버로 AI 에이전트(Claude Desktop 등)와 통합.

## MCP Tools

| 도구 | 설명 |
|------|------|
| `db_test_connection` | 환경변수 기반 DB 연결 테스트 |
| `db_connect` | 자격 증명으로 DB 연결 테스트 |
| `nl2sql_schema` | 스키마 조회 (json/prompt/summary) |
| `nl2sql_query` | 자연어 → SQL 변환 및 실행 |

## Transport Modes

- **stdio**: Claude Desktop 연동용 (기본값)
- **sse**: HTTP Server-Sent Events (웹 클라이언트용)

## Environment Variables

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `MCP_TRANSPORT` | 전송 모드 (stdio/sse) | stdio |
| `MCP_PORT` | SSE 서버 포트 | 3001 |
| `MCP_AUTH_TOKEN` | Bearer 인증 토큰 | - |

## SSE Mode Features

- Bearer 토큰 인증
- 헬스체크 엔드포인트 (`/health`)
- CORS 지원

## Version History

### v1.1.0
- Model Context Protocol 서버 구현
- stdio/SSE 듀얼 전송 모드
- MCP 도구 4종
- Docker 컨테이너 지원
- Bearer 토큰 인증 (SSE 모드)
