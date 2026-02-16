# Suggested Commands

## Build & Development
```bash
npm run build          # TypeScript 컴파일 (tsc)
npm run lint           # ESLint 검사
npm test               # Jest 테스트 실행
```

## CLI Usage
```bash
npm start -- query "자연어 쿼리"              # SQL 생성
npm start -- query "자연어 쿼리" -e           # SQL 생성 + 실행
npm start -- schema                           # 스키마 표시
npm start -- interactive                      # REPL 모드
npm start -- interactive --auto-execute       # 자동 실행 REPL
```

## MCP Server
```bash
npm run start:mcp        # stdio 모드 (Claude Desktop용)
npm run start:mcp:sse    # SSE HTTP 모드 (웹 클라이언트용)
```

## Docker
```bash
npm run docker:build                          # 이미지 빌드
npm run docker:run                            # MCP 서버 실행
npm run docker:stop                           # 중지
docker-compose --profile cli up -d            # CLI 실행
```

## Git (Darwin/macOS)
```bash
git status
git diff
git log --oneline -10
```
