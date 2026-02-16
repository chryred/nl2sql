# Two-Pass Table Selection Design

## Problem

운영 DB(600+ 테이블)의 전체 스키마 + 메타데이터를 LLM에 전달하면 ~100K 토큰 소비.
비용, 속도, 컨텍스트 윈도우 모두 비효율적.

## Solution

2-Pass 방식으로 관련 테이블만 선별 후 SQL 생성.

### Flow

```
User Query → 1st Pass (테이블 선별, ~10K tokens)
           → Filter schema & metadata
           → 2nd Pass (SQL 생성, ~5-8K tokens)
```

### 1st Pass Input

- 테이블 이름 + 코멘트 (컬럼 제외)
- 용어집 (GlossaryTerm + GlossaryAlias)
- 사용자 질문

### 1st Pass Output

- JSON 배열: 관련 테이블명 목록 (5~15개)

### 2nd Pass Input

- 선별된 테이블의 전체 스키마 (컬럼/타입/PK/FK/인덱스)
- 선별된 테이블 관련 메타데이터만 필터링
- DB별 가이드라인, 안전 규칙
- 사용자 질문

## Changes

| File | Change |
|------|--------|
| `src/ai/prompt-builder.ts` | `buildTableSelectionPrompt()`, `parseSelectedTables()` 추가 |
| `src/database/schema-extractor.ts` | `formatSchemaSummary()` 추가 |
| `src/core/nl2sql-engine.ts` | `generateSQL()` 2-Pass 로직, `filterSchema/Metadata` 추가 |

## Threshold

테이블 30개 이하일 때는 기존 single-pass 유지 (`TABLE_COUNT_THRESHOLD = 30`).

## Token Estimate

- Before: ~100K tokens (1 call)
- After: ~10K + ~8K = ~18K tokens (2 calls), **~82% reduction**
