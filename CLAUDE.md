# NL2SQL Project

자연어를 SQL로 변환하는 CLI 도구 및 MCP 서버

## Quick Reference

### Build & Test
```bash
npm run build        # TypeScript 컴파일
npm run lint         # ESLint 검사
npm test             # Jest 테스트
```

### CLI Commands
```bash
npm start -- query "자연어 쿼리"              # SQL 생성
npm start -- query "자연어 쿼리" -e           # SQL 생성 및 실행
npm start -- schema                           # 스키마 표시
npm start -- interactive                      # 대화형 REPL 모드
npm start -- interactive --auto-execute       # 자동 실행 모드
```

### MCP Server
```bash
npm run start:mcp        # stdio 모드 (Claude Desktop용)
npm run start:mcp:sse    # SSE HTTP 모드
```

### Docker
```bash
npm run docker:build                          # 이미지 빌드
npm run docker:run                            # MCP 서버 실행
npm run docker:stop                           # 중지
docker-compose --profile cli up -d            # Interactive CLI 실행
docker-compose --profile cli exec nl2sql-cli  # CLI 접속
```

## Project Structure
```
src/
├── index.ts              # CLI 진입점
├── cli/
│   ├── commands/         # query, schema 명령어
│   ├── formatters/       # 결과 포맷터
│   └── modes/            # interactive REPL 모드
├── config/               # 설정 로더 (Zod)
├── core/                 # NL2SQL 엔진
├── ai/providers/         # OpenAI, Anthropic
├── database/
│   ├── adapters/         # PostgreSQL, MySQL, Oracle 어댑터
│   ├── metadata/         # 메타데이터 캐시 시스템
│   └── schemas/metadata/ # DBMS별 메타데이터 쿼리 (YAML)
├── errors/               # 커스텀 에러
├── logger/               # 로깅 시스템
├── mcp/                  # MCP 서버
└── utils/                # 유틸리티

sql/                      # 메타데이터 스키마 SQL
├── postgresql/           # PostgreSQL DDL
├── mysql/                # MySQL DDL
└── oracle/               # Oracle DDL
```

## Key Features

### 메타데이터 캐시 시스템
- 서버 시작 시 메타데이터 테이블을 메모리에 캐싱
- 테이블 관계, 네이밍 컨벤션, 공통코드, 용어집, 쿼리 패턴 지원
- DBMS별 최적화된 쿼리 (YAML 설정)

### Interactive CLI (REPL)
- `.help` - 도움말
- `.schema [table]` - 스키마 조회
- `.format [type]` - 출력 형식 변경 (table/json/csv)
- `.execute` - 자동 실행 모드 토글
- `.cache` - 메타데이터 캐시 상태
- `.exit` - 종료

## Key Rules

1. **ESM 모듈**: import 시 `.js` 확장자 필수
2. **Zod 검증**: 설정은 Zod 스키마로 검증
3. **에러 마스킹**: Production에서 민감 정보 노출 금지
4. **SQL 보안**: DROP, DELETE 등 위험 쿼리 자동 차단
5. **입력 검증**: 프롬프트 인젝션 패턴 감지 필수

## Config Priority

CLI 옵션 > 환경변수 > 설정파일 > 기본값

## Metadata Schema Setup

```bash
# PostgreSQL
psql -U user -d dbname -f sql/postgresql/00_create_schema.sql
psql -U user -d dbname -f sql/postgresql/01_relationships.sql
# ... 나머지 파일들

# MySQL
mysql -u user -p dbname < sql/mysql/00_create_schema.sql
# ...

# Oracle
sqlplus user/pass@dbname @sql/oracle/00_create_schema.sql
# ...
```
