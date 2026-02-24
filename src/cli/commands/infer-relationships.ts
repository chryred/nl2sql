/**
 * FK 관계 추론 CLI 명령어 모듈
 *
 * @description
 * 네이밍 패턴 및 동일 컬럼명 기반으로 FK 관계를 자동 추론합니다.
 * preview 모드로 미리보기 후, apply 모드로 선택적 적용이 가능합니다.
 *
 * @module cli/commands/infer-relationships
 */

import chalk from 'chalk';
import ora from 'ora';
import type { Knex } from 'knex';
import type { Config } from '../../config/index.js';
import {
  inferRelationships,
  applyInferredRelationships,
  initializeMetadataCache,
  getMetadataCache,
} from '../../database/metadata/index.js';

/**
 * 추론 명령어 옵션
 */
export interface InferRelationshipsCommandOptions {
  mode?: 'preview' | 'apply';
  types?: string;
  schema?: string;
  format?: 'table' | 'json';
}

/**
 * FK 관계를 추론하고 결과를 출력합니다.
 *
 * @param knex - Knex 데이터베이스 연결
 * @param config - 설정 객체
 * @param options - 명령어 옵션
 */
export async function inferRelationshipsCommand(
  knex: Knex,
  config: Config,
  options: InferRelationshipsCommandOptions = {}
): Promise<void> {
  const mode = options.mode ?? 'preview';
  const format = options.format ?? 'table';
  const types = options.types
    ? (options.types.split(',') as ('naming_convention' | 'column_match')[])
    : undefined;

  // 메타데이터 캐시 초기화
  const cacheSpinner = ora('메타데이터 캐시 초기화 중...').start();
  try {
    await initializeMetadataCache(knex, config.database.type);
    cacheSpinner.succeed('메타데이터 캐시 초기화 완료');
  } catch {
    cacheSpinner.warn('메타데이터 캐시 초기화 실패 - 빈 캐시로 계속합니다.');
  }

  const cache = getMetadataCache();
  const namingConventions = cache?.namingConventions ?? [];
  const existingRelationships = cache?.relationships ?? [];

  // 추론 실행
  const inferSpinner = ora('FK 관계 추론 중...').start();
  const candidates = await inferRelationships(
    knex,
    config.database.type,
    namingConventions,
    existingRelationships,
    { schema: options.schema, types }
  );
  inferSpinner.succeed(`${candidates.length}개 관계 후보 발견`);

  if (candidates.length === 0) {
    console.log(chalk.gray('\n추론할 새로운 관계가 없습니다.'));
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify({ candidates, mode }, null, 2));
    if (mode === 'preview') return;
  } else {
    // 타입별 분류 출력
    const ncList = candidates.filter((c) => c.inferenceType === 'naming_convention');
    const cmList = candidates.filter((c) => c.inferenceType === 'column_match');
    if (ncList.length > 0) {
      console.log(chalk.bold(`\nNaming Convention (MEDIUM): ${ncList.length}건`));
      for (const c of ncList) {
        console.log(`  ${c.sourceTable}.${c.sourceColumn} → ${c.targetTable}.${c.targetColumn} [${c.matchedPattern}]`);
      }
    }
    if (cmList.length > 0) {
      console.log(chalk.bold(`\nColumn Match (LOW): ${cmList.length}건`));
      for (const c of cmList) {
        console.log(`  ${c.sourceTable}.${c.sourceColumn} → ${c.targetTable}.${c.targetColumn}`);
      }
    }
  }

  if (mode === 'preview') {
    console.log(
      chalk.yellow(
        '\n미리보기 모드입니다. --mode apply 옵션으로 적용하세요.'
      )
    );
    return;
  }

  // apply 모드
  const applySpinner = ora('관계 적용 중...').start();
  const { applied, skipped } = await applyInferredRelationships(
    knex,
    config.database.type,
    candidates,
    config.database.oracleDataCharset
  );
  applySpinner.succeed(`적용: ${applied}건, 스킵: ${skipped}건`);

  if (format === 'json') {
    console.log(JSON.stringify({ applied, skipped }, null, 2));
  }
}
