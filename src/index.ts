#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig, validateConfig } from './config/index.js';
import {
  createConnection,
  testConnection,
  closeConnection,
} from './database/connection.js';
import { queryCommand } from './cli/commands/query.js';
import { schemaCommand } from './cli/commands/schema.js';
import { startInteractiveMode } from './cli/modes/interactive.js';
import {
  initializeMetadataCache,
  setupMetadataSchema,
} from './database/metadata/index.js';
import {
  NL2SQLError,
  maskSensitiveInfo,
  getErrorMessage,
} from './errors/index.js';
import {
  isValidFormat,
  type OutputFormat,
} from './cli/formatters/result-formatter.js';

const program = new Command();

program
  .name('nl2sql')
  .description('자연어를 SQL 쿼리로 변환')
  .version('1.0.0')
  .enablePositionalOptions();

program
  .command('query')
  .alias('q')
  .description('자연어에서 SQL 생성')
  .argument('<query>', '자연어 쿼리')
  .option('-e, --execute', '생성된 쿼리 실행')
  .option('-y, --yes', '확인 프롬프트 건너뛰기')
  .option('-f, --format <format>', '결과 출력 형식 (table, json, csv)', 'table')
  .action(
    async (
      query: string,
      options: { execute?: boolean; yes?: boolean; format?: string }
    ) => {
      // 출력 형식 검증
      const format = options.format || 'table';
      if (!isValidFormat(format)) {
        console.error(
          chalk.red(`잘못된 형식: ${format}. table, json, csv 중 선택하세요.`)
        );
        process.exit(1);
      }

      await runWithConnection(async (knex, config) => {
        await queryCommand(knex, config, query, {
          execute: options.execute,
          noConfirm: options.yes,
          format: format as OutputFormat,
        });
      });
    }
  );

program
  .command('schema')
  .alias('s')
  .description('데이터베이스 스키마 표시')
  .option('-f, --format <format>', '출력 형식 (table, json, prompt)', 'table')
  .action(async (options: { format?: 'table' | 'json' | 'prompt' }) => {
    await runWithConnection(async (knex, config) => {
      await schemaCommand(knex, config, { format: options.format });
    });
  });

program
  .command('setup')
  .description('메타데이터 테이블 자동 생성')
  .option('-y, --yes', '확인 프롬프트 건너뛰기')
  .action(async (options: { yes?: boolean }) => {
    await runWithConnection(async (knex, config) => {

      if (!options.yes) {
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            chalk.yellow(
              `'${config.database.database}' 데이터베이스에 메타데이터 테이블을 생성합니다. 계속하시겠습니까? (y/N) `
            ),
            resolve
          );
        });
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          console.log(chalk.gray('취소되었습니다.'));
          return;
        }
      }

      const spinner = ora('메타데이터 테이블 생성 중...').start();
      const result = await setupMetadataSchema(knex, config.database.type);
      spinner.stop();

      for (const table of result.tables) {
        switch (table.status) {
          case 'created':
            console.log(chalk.green(`  + ${table.tableName}: ${table.message}`));
            break;
          case 'skipped':
            console.log(chalk.gray(`  - ${table.tableName}: ${table.message}`));
            break;
          case 'error':
            console.log(chalk.red(`  ! ${table.tableName}: ${table.message}`));
            break;
        }
      }

      const created = result.tables.filter((t) => t.status === 'created').length;
      const skipped = result.tables.filter((t) => t.status === 'skipped').length;
      const errors = result.tables.filter((t) => t.status === 'error').length;

      console.log('');
      if (result.success) {
        console.log(
          chalk.green(`완료: ${created}개 생성, ${skipped}개 스킵`)
        );
      } else {
        console.log(
          chalk.red(
            `완료: ${created}개 생성, ${skipped}개 스킵, ${errors}개 오류`
          )
        );
      }
    });
  });

program
  .command('interactive')
  .alias('i')
  .description('대화형 REPL 모드 시작')
  .option('-f, --format <format>', '기본 출력 형식 (table, json, csv)', 'table')
  .option('-e, --auto-execute', '쿼리 자동 실행')
  .action(async (options: { format?: string; autoExecute?: boolean }) => {
    await runWithConnection(
      async (knex, config) => {
        // 메타데이터 캐시 초기화
        const cacheSpinner = ora('메타데이터 캐시 초기화 중...').start();
        try {
          await initializeMetadataCache(knex, config.database.type);
          cacheSpinner.succeed('메타데이터 캐시 초기화 완료');
        } catch (error) {
          cacheSpinner.warn(
            '메타데이터 캐시 초기화 실패 - 기본 모드로 계속합니다.'
          );
        }

        await startInteractiveMode(knex, config, {
          defaultFormat: (options.format as OutputFormat) || 'table',
          autoExecute: options.autoExecute,
        });
      },
      { keepAlive: true }
    );
  });

// Default command: direct query
program
  .argument('[query]', '자연어 쿼리')
  .option('-e, --execute', '생성된 쿼리 실행')
  .option('-y, --yes', '확인 프롬프트 건너뛰기')
  .option('-f, --format <format>', '결과 출력 형식 (table, json, csv)', 'table')
  .action(
    async (
      query?: string,
      options?: { execute?: boolean; yes?: boolean; format?: string }
    ) => {
      if (!query) {
        program.help();
        return;
      }
      // 출력 형식 검증
      const format = options?.format || 'table';
      if (!isValidFormat(format)) {
        console.error(
          chalk.red(`잘못된 형식: ${format}. table, json, csv 중 선택하세요.`)
        );
        process.exit(1);
      }

      await runWithConnection(async (knex, config) => {
        await queryCommand(knex, config, query, {
          execute: options?.execute,
          noConfirm: options?.yes,
          format: format as OutputFormat,
        });
      });
    }
  );

/**
 * 데이터베이스 연결을 관리하며 명령어를 실행합니다.
 *
 * @description
 * 연결 설정, 명령어 실행, 에러 처리, 연결 해제를 담당합니다.
 * 민감한 정보는 마스킹하여 출력합니다.
 *
 * @param fn - 실행할 함수
 * @param options - 옵션 (keepAlive: 연결 유지 여부)
 */
async function runWithConnection(
  fn: (
    knex: ReturnType<typeof createConnection>,
    config: ReturnType<typeof getConfig>
  ) => Promise<void>,
  options: { keepAlive?: boolean } = {}
): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  let config;

  try {
    config = getConfig();
    validateConfig(config);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(chalk.red('설정 오류:'), message);
    console.error(chalk.yellow('.env 파일 또는 환경 변수를 확인하세요.'));
    process.exit(1);
  }

  // 연결 정보 마스킹 (production에서는 상세 정보 숨김)
  const connectionInfo = isProduction
    ? `${config.database.type} database`
    : `${config.database.type}://${maskSensitiveInfo(config.database.host)}:${config.database.port}/${config.database.database}`;

  const spinner = ora(`${connectionInfo}에 연결 중...`).start();

  let knex;
  try {
    knex = createConnection(config);
    const connected = await testConnection(knex);
    if (!connected) {
      spinner.fail('데이터베이스 연결 실패');
      process.exit(1);
    }

    spinner.succeed(`데이터베이스 연결됨: ${config.database.database}`);
  } catch (error) {
    spinner.fail('데이터베이스 연결 오류');
    const message = getErrorMessage(error);
    console.error(chalk.red(message));
    process.exit(1);
  }

  try {
    await fn(knex, config);
  } catch (error) {
    // 커스텀 에러 처리
    if (error instanceof NL2SQLError) {
      const message = isProduction
        ? error.toUserMessage()
        : maskSensitiveInfo(error.message);
      console.error(chalk.red('오류:'), message);
    } else {
      const message = getErrorMessage(error);
      console.error(chalk.red('오류:'), message);
    }
    process.exit(1);
  } finally {
    // keepAlive 옵션이 없으면 연결 종료
    if (!options.keepAlive) {
      await closeConnection();
    }
  }
}

program.parse();
