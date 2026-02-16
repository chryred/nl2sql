/**
 * Interactive CLI (REPL) 모드
 *
 * @description
 * Docker 환경에서 지속적으로 실행되는 대화형 CLI 모드입니다.
 * 사용자가 자연어 쿼리를 계속 입력하고 결과를 받을 수 있습니다.
 *
 * @module cli/modes/interactive
 */

import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import type { Knex } from 'knex';
import type { Config } from '../../config/index.js';
import { NL2SQLEngine } from '../../core/nl2sql-engine.js';
import { validateNaturalLanguageInput } from '../../utils/input-validator.js';
import {
  formatResults,
  type OutputFormat,
} from '../formatters/result-formatter.js';
import {
  getMetadataCacheStats,
  inferRelationships,
  applyInferredRelationships,
  getMetadataCache,
} from '../../database/metadata/index.js';
import { formatInferenceResult } from '../../mcp/tools/infer-relationships.js';
import { logger } from '../../logger/index.js';

/**
 * Interactive 모드 옵션
 */
export interface InteractiveOptions {
  /** 기본 출력 형식 */
  defaultFormat?: OutputFormat;
  /** 쿼리 자동 실행 여부 */
  autoExecute?: boolean;
  /** 프롬프트 문자열 */
  prompt?: string;
  /** 환영 메시지 표시 여부 */
  showWelcome?: boolean;
}

/**
 * REPL 명령어 정의
 */
const COMMANDS = {
  HELP: ['.help', '.h', '?'] as readonly string[],
  EXIT: ['.exit', '.quit', '.q'] as readonly string[],
  CLEAR: ['.clear', '.cls'] as readonly string[],
  SCHEMA: ['.schema', '.s'] as readonly string[],
  FORMAT: ['.format', '.f'] as readonly string[],
  EXECUTE: ['.execute', '.exec', '.e'] as readonly string[],
  CACHE: ['.cache'] as readonly string[],
  REFRESH: ['.refresh'] as readonly string[],
  INFER: ['.infer', '.ir'] as readonly string[],
} as const;

/**
 * Interactive CLI 세션 클래스
 */
export class InteractiveSession {
  private rl: readline.Interface;
  private engine: NL2SQLEngine;
  private currentFormat: OutputFormat;
  private autoExecute: boolean;
  private prompt: string;
  private isRunning: boolean = false;

  constructor(
    private knex: Knex,
    private config: Config,
    options: InteractiveOptions = {}
  ) {
    this.currentFormat = options.defaultFormat || 'table';
    this.autoExecute = options.autoExecute || false;
    this.prompt = options.prompt || 'nl2sql> ';
    this.engine = new NL2SQLEngine(knex, config);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Graceful shutdown
    process.on('SIGINT', () => this.handleExit());
    process.on('SIGTERM', () => this.handleExit());
  }

  /**
   * Interactive 세션을 시작합니다.
   */
  async start(showWelcome: boolean = true): Promise<void> {
    if (showWelcome) {
      this.printWelcome();
    }

    // 스키마 미리 로드
    const schemaSpinner = ora('데이터베이스 스키마 로딩 중...').start();
    try {
      const schema = await this.engine.getSchema();
      schemaSpinner.succeed(
        `스키마 로드 완료 (${schema.tables.length}개 테이블)`
      );
    } catch (error) {
      schemaSpinner.warn('스키마 로드 실패 - 쿼리 실행 시 다시 시도합니다.');
      if (error instanceof Error) {
        logger.error('Schema loading failed', error);
      }
    }

    this.isRunning = true;
    await this.runLoop();
  }

  /**
   * 메인 REPL 루프
   */
  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const input = await this.promptInput();
        const trimmedInput = input.trim();

        if (!trimmedInput) {
          continue;
        }

        // 명령어 처리
        if (trimmedInput.startsWith('.') || trimmedInput === '?') {
          await this.handleCommand(trimmedInput);
          continue;
        }

        // 자연어 쿼리 처리
        await this.handleQuery(trimmedInput);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') {
          break;
        }
        if (error instanceof Error) {
          logger.error('REPL error', error);
        }
      }
    }
  }

  /**
   * 사용자 입력을 받습니다.
   */
  private promptInput(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.rl.question(chalk.cyan(this.prompt), (answer) => {
        if (answer === undefined) {
          reject(new Error('EOF'));
        } else {
          resolve(answer);
        }
      });
    });
  }

  /**
   * 명령어를 처리합니다.
   */
  private async handleCommand(input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (COMMANDS.HELP.includes(cmd)) {
      this.printHelp();
    } else if (COMMANDS.EXIT.includes(cmd)) {
      this.handleExit();
    } else if (COMMANDS.CLEAR.includes(cmd)) {
      console.clear();
    } else if (COMMANDS.SCHEMA.includes(cmd)) {
      await this.showSchema(args[0]);
    } else if (COMMANDS.FORMAT.includes(cmd)) {
      this.setFormat(args[0]);
    } else if (COMMANDS.EXECUTE.includes(cmd)) {
      this.toggleAutoExecute();
    } else if (COMMANDS.CACHE.includes(cmd)) {
      this.showCacheStats();
    } else if (COMMANDS.REFRESH.includes(cmd)) {
      await this.refreshCache();
    } else if (COMMANDS.INFER.includes(cmd)) {
      await this.handleInfer(args);
    } else {
      console.log(chalk.yellow(`알 수 없는 명령어: ${cmd}`));
      console.log(
        chalk.gray('.help 를 입력하여 사용 가능한 명령어를 확인하세요.')
      );
    }
  }

  /**
   * 자연어 쿼리를 처리합니다.
   */
  private async handleQuery(query: string): Promise<void> {
    // 입력 검증
    const validation = validateNaturalLanguageInput(query);
    if (!validation.valid) {
      console.log(chalk.red(`입력 오류: ${validation.error}`));
      return;
    }

    const sanitizedQuery = validation.sanitized;

    // SQL 생성
    const sqlSpinner = ora('SQL 생성 중...').start();
    let sql: string;

    try {
      sql = await this.engine.generateSQL(sanitizedQuery);
      sqlSpinner.succeed('SQL 생성 완료');
    } catch (error) {
      sqlSpinner.fail('SQL 생성 실패');
      console.log(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
      return;
    }

    // SQL 출력
    console.log('');
    console.log(chalk.bold('생성된 SQL:'));
    console.log(chalk.green(sql));
    console.log('');

    // 자동 실행 또는 실행 여부 확인
    if (this.autoExecute) {
      await this.executeQuery(sql);
    } else {
      console.log(
        chalk.gray('실행하려면 y를 입력하세요. (자동 실행: .execute)')
      );
      const answer = await this.promptInput();
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        await this.executeQuery(sql);
      }
    }
  }

  /**
   * SQL을 실행합니다.
   */
  private async executeQuery(sql: string): Promise<void> {
    const execSpinner = ora('쿼리 실행 중...').start();

    try {
      const results = await this.engine.executeSQL(sql);
      execSpinner.succeed(`쿼리 실행 완료 (${results.length}개 행)`);

      if (results.length > 0) {
        console.log('');
        console.log(chalk.bold('결과:'));
        const formatted = formatResults(results, this.currentFormat);
        console.log(formatted);
      }
    } catch (error) {
      execSpinner.fail('쿼리 실행 실패');
      console.log(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * 스키마를 출력합니다.
   */
  private async showSchema(tableName?: string): Promise<void> {
    const spinner = ora('스키마 조회 중...').start();

    try {
      const schema = await this.engine.getSchema();
      spinner.stop();

      if (tableName) {
        const table = schema.tables.find(
          (t) => t.name.toLowerCase() === tableName.toLowerCase()
        );
        if (table) {
          console.log(chalk.bold(`\n테이블: ${table.name}`));
          if (table.comment) {
            console.log(chalk.gray(`설명: ${table.comment}`));
          }
          console.log(chalk.bold('\n컬럼:'));
          for (const col of table.columns) {
            const pk = col.isPrimaryKey ? chalk.yellow(' [PK]') : '';
            const fk = col.isForeignKey ? chalk.blue(' [FK]') : '';
            const nullable = col.nullable ? '' : chalk.red(' NOT NULL');
            console.log(`  ${col.name}: ${col.type}${pk}${fk}${nullable}`);
          }
        } else {
          console.log(chalk.yellow(`테이블을 찾을 수 없음: ${tableName}`));
        }
      } else {
        console.log(chalk.bold('\n테이블 목록:'));
        for (const table of schema.tables) {
          const comment = table.comment
            ? chalk.gray(` - ${table.comment}`)
            : '';
          console.log(
            `  ${table.name} (${table.columns.length}개 컬럼)${comment}`
          );
        }
      }
      console.log('');
    } catch (error) {
      spinner.fail('스키마 조회 실패');
      console.log(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * 출력 형식을 설정합니다.
   */
  private setFormat(format?: string): void {
    if (!format) {
      console.log(chalk.cyan(`현재 출력 형식: ${this.currentFormat}`));
      console.log(chalk.gray('사용 가능: table, json, csv'));
      return;
    }

    if (['table', 'json', 'csv'].includes(format)) {
      this.currentFormat = format as OutputFormat;
      console.log(chalk.green(`출력 형식 변경: ${format}`));
    } else {
      console.log(chalk.yellow(`잘못된 형식: ${format}`));
      console.log(chalk.gray('사용 가능: table, json, csv'));
    }
  }

  /**
   * 자동 실행 모드를 토글합니다.
   */
  private toggleAutoExecute(): void {
    this.autoExecute = !this.autoExecute;
    console.log(
      chalk.green(`자동 실행 모드: ${this.autoExecute ? '활성화' : '비활성화'}`)
    );
  }

  /**
   * 캐시 통계를 출력합니다.
   */
  private showCacheStats(): void {
    const stats = getMetadataCacheStats();

    console.log(chalk.bold('\n메타데이터 캐시 상태:'));
    console.log(
      `  초기화: ${stats.initialized ? chalk.green('예') : chalk.red('아니오')}`
    );

    if (stats.initialized) {
      console.log(`  데이터베이스: ${stats.databaseType}`);
      console.log(`  로드 시간: ${stats.loadedAt?.toISOString()}`);
      console.log(chalk.bold('\n  항목 수:'));
      for (const [key, count] of Object.entries(stats.counts)) {
        console.log(`    ${key}: ${count}`);
      }
    }
    console.log('');
  }

  /**
   * 캐시를 새로고침합니다.
   */
  private async refreshCache(): Promise<void> {
    const spinner = ora('캐시 새로고침 중...').start();

    try {
      // 메타데이터 캐시 새로고침은 별도 구현 필요
      // 현재는 스키마만 새로고침
      await this.engine.getSchema();
      spinner.succeed('캐시 새로고침 완료');
    } catch (error) {
      spinner.fail('캐시 새로고침 실패');
      console.log(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * FK 관계 추론을 실행합니다.
   *
   * @param args - [mode] preview 또는 apply
   */
  private async handleInfer(args: string[]): Promise<void> {
    const mode = args[0] === 'apply' ? 'apply' : 'preview';
    const spinner = ora('FK 관계 추론 중...').start();

    try {
      const cache = getMetadataCache();
      const namingConventions = cache?.namingConventions ?? [];
      const existingRelationships = cache?.relationships ?? [];

      const candidates = await inferRelationships(
        this.knex,
        this.config.database.type,
        namingConventions,
        existingRelationships
      );
      spinner.succeed(`${candidates.length}개 관계 후보 발견`);

      if (candidates.length === 0) {
        console.log(chalk.gray('추론할 새로운 관계가 없습니다.'));
        return;
      }

      console.log(formatInferenceResult({ candidates }));

      if (mode === 'apply') {
        const applySpinner = ora('관계 적용 중...').start();
        const { applied, skipped } = await applyInferredRelationships(
          this.knex,
          this.config.database.type,
          candidates,
          this.config.database.oracleDataCharset
        );
        applySpinner.succeed(`적용: ${applied}건, 스킵: ${skipped}건`);
      } else {
        console.log(
          chalk.yellow('.infer apply 로 적용할 수 있습니다.')
        );
      }
    } catch (error) {
      spinner.fail('FK 관계 추론 실패');
      console.log(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * 환영 메시지를 출력합니다.
   */
  private printWelcome(): void {
    console.log('');
    console.log(
      chalk.bold.cyan('╔═══════════════════════════════════════════════╗')
    );
    console.log(
      chalk.bold.cyan('║         NL2SQL Interactive Mode               ║')
    );
    console.log(
      chalk.bold.cyan('║   자연어를 SQL로 변환하는 대화형 인터페이스   ║')
    );
    console.log(
      chalk.bold.cyan('╚═══════════════════════════════════════════════╝')
    );
    console.log('');
    console.log(chalk.gray('자연어로 쿼리를 입력하세요. 도움말: .help'));
    console.log(
      chalk.gray(
        `데이터베이스: ${this.config.database.type}://${this.config.database.host}:${this.config.database.port}/${this.config.database.database}`
      )
    );
    console.log('');
  }

  /**
   * 도움말을 출력합니다.
   */
  private printHelp(): void {
    console.log('');
    console.log(chalk.bold('사용 가능한 명령어:'));
    console.log('');
    console.log(chalk.cyan('  .help, .h, ?') + '     이 도움말 표시');
    console.log(chalk.cyan('  .exit, .quit, .q') + ' 종료');
    console.log(chalk.cyan('  .clear, .cls') + '     화면 지우기');
    console.log(
      chalk.cyan('  .schema [table]') + '  스키마 표시 (테이블명 선택적)'
    );
    console.log(
      chalk.cyan('  .format [type]') + '   출력 형식 설정 (table/json/csv)'
    );
    console.log(chalk.cyan('  .execute') + '         자동 실행 모드 토글');
    console.log(
      chalk.cyan('  .cache') + '           메타데이터 캐시 상태 표시'
    );
    console.log(chalk.cyan('  .refresh') + '         캐시 새로고침');
    console.log(
      chalk.cyan('  .infer [apply]') + '   FK 관계 추론 (기본: preview)'
    );
    console.log('');
    console.log(chalk.gray('자연어 쿼리를 입력하면 SQL로 변환됩니다.'));
    console.log(chalk.gray('예: "최근 가입한 사용자 10명 보여줘"'));
    console.log('');
  }

  /**
   * 종료를 처리합니다.
   */
  private handleExit(): void {
    console.log(chalk.cyan('\n안녕히 가세요! 👋'));
    this.isRunning = false;
    this.rl.close();
    process.exit(0);
  }
}

/**
 * Interactive 모드를 시작합니다.
 *
 * @param knex - Knex 데이터베이스 연결
 * @param config - 애플리케이션 설정
 * @param options - Interactive 옵션
 *
 * @example
 * await startInteractiveMode(knex, config, { autoExecute: true });
 */
export async function startInteractiveMode(
  knex: Knex,
  config: Config,
  options: InteractiveOptions = {}
): Promise<void> {
  const session = new InteractiveSession(knex, config, options);
  await session.start(options.showWelcome !== false);
}
