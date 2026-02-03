---
name: db-test
description: Test database connection with current environment variables
user-invocable: true
---

# Database Connection Test

현재 환경변수로 데이터베이스 연결을 테스트합니다.

## Instructions

1. 먼저 `.env` 파일에서 DB 설정을 확인하세요
2. `npm run build`로 빌드가 완료되었는지 확인하세요
3. 다음 명령으로 연결 테스트를 실행하세요:

```bash
npx tsx src/index.ts test-connection
```

## Expected Output

- 성공 시: "Database connection successful" 메시지
- 실패 시: 연결 에러 상세 정보

## Troubleshooting

연결 실패 시 확인사항:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` 환경변수
- 데이터베이스 서버 실행 상태
- 방화벽/네트워크 설정
