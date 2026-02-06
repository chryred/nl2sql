/**
 * 자연어 쿼리 CLI 명령어 모듈
 *
 * @description
 * 자연어를 SQL로 변환하고 선택적으로 실행하는 CLI 명령어입니다.
 * NL2SQL 엔진을 사용하여 사용자의 자연어 요청을 SQL 쿼리로 변환합니다.
 *
 * @module cli/commands/query
 *
 * @example
 * // CLI 사용 예시
 * npm start -- query "최근 가입한 사용자 10명"
 * npm start -- query "주문 총액" --execute
 * npm start -- query "활성 사용자" --execute --no-confirm
 * npm start -- query "사용자 목록" --execute --format json
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import type { Knex } from 'knex';
import type { Config } from '../../config/index.js';
import { NL2SQLEngine } from '../../core/nl2sql-engine.js';
import { validateNaturalLanguageInput } from '../../utils/input-validator.js';
import { InputValidationError } from '../../errors/index.js';
import {
  formatResults,
  type OutputFormat,
} from '../formatters/result-formatter.js';

/**
 * 쿼리 명령어 옵션 인터페이스
 *
 * @description
 * queryCommand 함수에 전달할 옵션을 정의합니다.
 */
export interface QueryCommandOptions {
  /**
   * SQL 실행 여부
   * true이면 생성된 SQL을 실행하고 결과를 표시합니다.
   */
  execute?: boolean;

  /**
   * 실행 전 확인 건너뛰기
   * true이면 실행 전 확인 프롬프트 없이 바로 실행합니다.
   */
  noConfirm?: boolean;

  /**
   * 출력 형식
   * 쿼리 결과를 표시할 형식을 지정합니다.
   * - table: 테이블 형식 (기본값)
   * - json: JSON 형식
   * - csv: CSV 형식
   */
  format?: OutputFormat;
}

/**
 * 자연어 쿼리를 SQL로 변환하고 실행합니다.
 *
 * @description
 * 자연어 요청을 받아 SQL로 변환하는 명령어입니다.
 *
 * 처리 과정:
 * 1. 데이터베이스 스키마 추출
 * 2. AI 모델을 통한 SQL 생성
 * 3. 생성된 SQL 표시
 * 4. (선택적) 사용자 확인 후 SQL 실행
 * 5. (선택적) 실행 결과 표시
 *
 * @param knex - Knex 데이터베이스 연결 인스턴스
 * @param config - 애플리케이션 설정 객체
 * @param naturalLanguageQuery - 변환할 자연어 쿼리
 * @param options - 명령어 옵션
 * @throws 스키마 추출, SQL 생성, 또는 실행 실패 시 에러
 *
 * @example
 * // SQL 생성만
 * await queryCommand(knex, config, '사용자 목록');
 *
 * // SQL 생성 및 실행 (확인 프롬프트 표시)
 * await queryCommand(knex, config, '사용자 목록', { execute: true });
 *
 * // SQL 생성 및 즉시 실행 (확인 없이)
 * await queryCommand(knex, config, '사용자 목록', {
 *   execute: true,
 *   noConfirm: true
 * });
 */
export async function queryCommand(
  knex: Knex,
  config: Config,
  naturalLanguageQuery: string,
  options: QueryCommandOptions = {}
): Promise<void> {
  // 입력 검증
  const validationResult = validateNaturalLanguageInput(naturalLanguageQuery);
  if (!validationResult.valid) {
    throw new InputValidationError(
      validationResult.error || 'Invalid input',
      naturalLanguageQuery
    );
  }

  // 정제된 입력 사용
  const sanitizedQuery = validationResult.sanitized;
  const engine = new NL2SQLEngine(knex, config);

  // Extract schema
  const schemaSpinner = ora('데이터베이스 스키마 추출 중...').start();
  try {
    const schema = await engine.getSchema();
    schemaSpinner.succeed(
      `스키마 추출 완료 (${schema.tables.length}개 테이블)`
    );
  } catch (error) {
    schemaSpinner.fail('스키마 추출 실패');
    throw error;
  }

  // Generate SQL
  const sqlSpinner = ora('SQL 생성 중...').start();
  let sql: string;
  try {
    sql = await engine.generateSQL(sanitizedQuery);
    sqlSpinner.succeed('SQL 생성 완료');
  } catch (error) {
    sqlSpinner.fail('SQL 생성 실패');
    throw error;
  }

  // Display generated SQL
  console.log('');
  console.log(chalk.bold('생성된 SQL:'));
  console.log(chalk.green(sql));
  console.log('');

  // Execute if requested
  if (options.execute) {
    let shouldExecute = true;

    if (!options.noConfirm) {
      const answer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'execute',
          message: '이 쿼리를 실행하시겠습니까?',
          default: false,
        },
      ]);
      shouldExecute = answer.execute as boolean;
    }

    if (shouldExecute) {
      const execSpinner = ora('쿼리 실행 중...').start();
      try {
        const results = await engine.executeSQL(sql);
        execSpinner.succeed(`쿼리 실행 완료 (${results.length}개 행)`);

        if (results.length > 0) {
          console.log('');
          console.log(chalk.bold('결과:'));

          // 포맷 옵션에 따른 출력
          const outputFormat = options.format || 'table';
          const formatted = formatResults(results, outputFormat);
          console.log(formatted);
        }
      } catch (error) {
        execSpinner.fail('쿼리 실행 실패');
        throw error;
      }
    }
  }
}
