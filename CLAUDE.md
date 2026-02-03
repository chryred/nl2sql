# NL2SQL Project

자연어를 SQL로 변환하는 CLI 도구 및 MCP 서버

## Quick Reference

### Build & Test
```bash
npm run build        # TypeScript 컴파일
npm run lint         # ESLint 검사
npm test             # Jest 테스트
```

### MCP Server
```bash
npm run start:mcp        # stdio 모드 (Claude Desktop용)
npm run start:mcp:sse    # SSE HTTP 모드
```

### Docker
```bash
npm run docker:build     # 이미지 빌드
npm run docker:run       # Compose 실행
npm run docker:stop      # Compose 중지
```

## Project Structure
```
src/
├── index.ts          # CLI 진입점
├── cli/              # CLI 명령어, 포맷터
├── config/           # 설정 로더 (Zod)
├── core/             # 핵심 로직
├── ai/providers/     # OpenAI, Anthropic
├── database/         # DB 연결, 스키마
├── errors/           # 커스텀 에러
├── mcp/              # MCP 서버
└── utils/            # 유틸리티
```

## Key Rules

1. **ESM 모듈**: import 시 `.js` 확장자 필수
2. **Zod 검증**: 설정은 Zod 스키마로 검증
3. **에러 마스킹**: Production에서 민감 정보 노출 금지
4. **SQL 보안**: DROP, DELETE 등 위험 쿼리 자동 차단
5. **입력 검증**: 프롬프트 인젝션 패턴 감지 필수

## Config Priority

CLI 옵션 > 환경변수 > 설정파일 > 기본값
