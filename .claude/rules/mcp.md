---
description: MCP server development rules
globs: ['src/mcp/**']
---

# MCP Server Guide

Model Context Protocol 서버로 AI 에이전트(Claude Desktop 등)와 통합.

## MCP Tools

| 도구                     | 설명                                                    |
| ------------------------ | ------------------------------------------------------- |
| `db_test_connection`     | 환경변수 기반 DB 연결 테스트                            |
| `db_connect`             | 자격 증명으로 DB 연결 테스트                            |
| `nl2sql_schema`          | 스키마 조회 (json/prompt/summary)                       |
| `nl2sql_query`           | 자연어 → SQL 변환 및 실행                               |
| `cache_status`           | 메타데이터 캐시 상태 조회                               |
| `cache_refresh`          | 메타데이터 캐시 새로고침 (Docker 재기동 불필요)         |
| `infer_relationships`    | 네이밍 패턴/동일 컬럼명 기반 FK 관계 자동 추론          |
| `auto_generate_comments` | 미설정 테이블/컬럼 코멘트 AI 자동 생성 (preview/apply)  |
| `query_pattern_add`      | 자주 사용하는 쿼리 패턴 등록 (DB 저장 + 캐시 자동 갱신) |
| `query_pattern_search`   | 패턴명/설명 키워드로 쿼리 패턴 검색 및 조회             |

## Transport Modes

- **stdio**: Claude Desktop 연동용 (기본값)
- **sse**: HTTP Server-Sent Events (웹 클라이언트용)

## Environment Variables

| 변수             | 설명                  | 기본값 |
| ---------------- | --------------------- | ------ |
| `MCP_TRANSPORT`  | 전송 모드 (stdio/sse) | stdio  |
| `MCP_PORT`       | SSE 서버 포트         | 3001   |
| `MCP_AUTH_TOKEN` | Bearer 인증 토큰      | -      |

## SSE Mode Features

- Bearer 토큰 인증
- 헬스체크 엔드포인트 (`/health`)
- CORS 지원

## Version History

### v1.5.1

- SSE 모드 이중 SIGINT/SIGTERM 핸들러 race condition 수정
- `startSSEServer()` cleanup 함수 반환으로 시그널 핸들러 통합 관리

### v1.6.0

- `auto_generate_comments` MCP 도구 추가 (10단계): 미설정 테이블/컬럼 코멘트 AI 자동 생성
- preview/apply 2단계 모드: preview로 후보 확인 후 apply로 DB 적용
- PostgreSQL/MySQL/Oracle 3개 DBMS 지원
- Oracle oracleDataCharset 설정 시 UTL_RAW 기반 한글 처리
- 기존 코멘트 덮어쓰기 없음, 미설정 대상만 처리
- MCP 도구 13단계 체계로 확장 (기존 12단계)

### v1.5.0

- 1st Pass 테이블 선별 프롬프트 강화 (TABLE_RELATIONSHIPS, queryPatterns 힌트, patternKeywords 추가)
- JOIN 필요 테이블 누락 방지: 관계 정보 기반으로 관련 테이블 자동 포함
- `query_pattern_add` MCP 도구 추가 (8단계): 자주 사용하는 쿼리 패턴 DB 등록 + 캐시 자동 갱신
- `query_pattern_search` MCP 도구 추가 (9단계): 패턴명/설명 키워드 검색 (ILIKE)
- MCP 도구 12단계 체계로 확장 (기존 10단계)

### v1.4.0

- Two-Pass 테이블 선별 기능 추가 (30+ 테이블 환경에서 토큰 ~82% 절감)
- 1st Pass: 테이블명 + 코멘트 + 용어집으로 관련 테이블 선별
- 2nd Pass: 선별된 테이블의 상세 스키마로 SQL 생성

### v1.3.0

- FK 관계 자동 추론 MCP 도구 추가 (`infer_relationships`)
- 네이밍 컨벤션 기반 관계 추론 (MEDIUM 신뢰도, 자동 활성화)
- 동일 컬럼명 기반 관계 추론 (LOW 신뢰도, 수동 검토)
- SQL 배치 스크립트에 4~5단계 추가 (3개 DBMS)

### v1.2.0

- 메타데이터 캐시 관리 MCP 도구 추가 (`cache_status`, `cache_refresh`)
- Docker 재기동 없이 캐시 초기화 가능

### v1.1.0

- Model Context Protocol 서버 구현
- stdio/SSE 듀얼 전송 모드
- MCP 도구 4종
- Docker 컨테이너 지원
- Bearer 토큰 인증 (SSE 모드)
