/**
 * 스키마 조회 CLI 명령어 모듈
 *
 * @description
 * 데이터베이스 스키마를 조회하고 다양한 형식으로 출력하는 CLI 명령어입니다.
 * 테이블, 컬럼, 인덱스, 제약조건 정보를 시각적으로 표시합니다.
 *
 * @module cli/commands/schema
 *
 * @example
 * // CLI 사용 예시
 * npm start -- schema
 * npm start -- schema --format json
 * npm start -- schema --format prompt
 */

import chalk from 'chalk';
import ora from 'ora';
import type { Knex } from 'knex';
import type { Config } from '../../config/index.js';
import { extractSchema, formatSchemaForPrompt } from '../../database/schema-extractor.js';
import type { SchemaInfo } from '../../database/types.js';

/**
 * 스키마 명령어 옵션 인터페이스
 *
 * @description
 * schemaCommand 함수에 전달할 옵션을 정의합니다.
 */
export interface SchemaCommandOptions {
  /**
   * 출력 형식
   * - table: 컬러풀한 테이블 형식 (기본값)
   * - json: JSON 형식
   * - prompt: AI 프롬프트용 텍스트 형식
   */
  format?: 'table' | 'json' | 'prompt';
}

/**
 * 데이터베이스 스키마를 조회하고 출력합니다.
 *
 * @description
 * 연결된 데이터베이스의 스키마 정보를 추출하여 지정된 형식으로 출력합니다.
 * 시스템 스키마는 자동으로 제외되며, 사용자 스키마의 테이블만 표시됩니다.
 *
 * 출력 형식:
 * - **table** (기본): 컬러를 사용한 가독성 높은 형식
 *   - 테이블명, 컬럼, 타입, PK/FK 표시
 *   - 인덱스 및 제약조건 정보
 *   - 최근 쿼리 패턴 (가능한 경우)
 *
 * - **json**: 프로그래밍 처리용 JSON 형식
 *
 * - **prompt**: AI 프롬프트 생성용 텍스트 형식
 *
 * @param knex - Knex 데이터베이스 연결 인스턴스
 * @param config - 애플리케이션 설정 객체
 * @param options - 명령어 옵션 (출력 형식 등)
 * @throws 스키마 추출 실패 시 에러
 *
 * @example
 * // 기본 테이블 형식으로 출력
 * await schemaCommand(knex, config);
 *
 * // JSON 형식으로 출력
 * await schemaCommand(knex, config, { format: 'json' });
 *
 * // 프롬프트 형식으로 출력
 * await schemaCommand(knex, config, { format: 'prompt' });
 */
export async function schemaCommand(
  knex: Knex,
  config: Config,
  options: SchemaCommandOptions = {}
): Promise<void> {
  const spinner = ora('데이터베이스 스키마 추출 중...').start();

  try {
    const schema: SchemaInfo = await extractSchema(knex, config);
    const tableCount = schema.tables.length;
    const indexCount = schema.tables.reduce(
      (acc, t) => acc + (t.indexes?.length || 0),
      0
    );
    spinner.succeed(
      `스키마 추출 완료 (${tableCount}개 테이블, ${indexCount}개 인덱스)`
    );

    const format = options.format || 'table';

    if (format === 'json') {
      console.log(JSON.stringify(schema, null, 2));
      return;
    }

    if (format === 'prompt') {
      console.log(formatSchemaForPrompt(schema));
      return;
    }

    // Default table format
    console.log('');
    for (const table of schema.tables) {
      // Table header with schema name and comment
      const schemaPrefix = table.schemaName
        ? chalk.dim(`${table.schemaName}.`)
        : '';
      const tableComment = table.comment
        ? chalk.gray(` -- ${table.comment}`)
        : '';
      console.log(chalk.bold.blue(`📋 ${schemaPrefix}${table.name}`) + tableComment);

      // Columns
      for (const col of table.columns) {
        const typeStr = chalk.yellow(col.type);
        const flags: string[] = [];

        if (col.isPrimaryKey) flags.push(chalk.green('PK'));
        if (col.isForeignKey && col.references) {
          const refSchema = col.references.schema
            ? `${col.references.schema}.`
            : '';
          flags.push(
            chalk.cyan(`FK → ${refSchema}${col.references.table}.${col.references.column}`)
          );
        }
        if (!col.nullable) flags.push(chalk.red('NOT NULL'));

        const flagStr = flags.length > 0 ? ` ${flags.join(' ')}` : '';
        const commentStr = col.comment ? chalk.gray(` -- ${col.comment}`) : '';
        console.log(`   ${col.name}: ${typeStr}${flagStr}${commentStr}`);
      }

      // Indexes
      if (table.indexes && table.indexes.length > 0) {
        console.log(chalk.dim('   인덱스:'));
        for (const idx of table.indexes) {
          const uniqueStr = idx.unique ? chalk.magenta(' (UNIQUE)') : '';
          const typeStr = idx.type ? chalk.dim(` [${idx.type}]`) : '';
          console.log(
            chalk.dim(`     - ${idx.name}: `) +
              chalk.white(`[${idx.columns.join(', ')}]`) +
              uniqueStr +
              typeStr
          );
        }
      }

      // Constraints (show non-PK/FK constraints)
      const otherConstraints = table.constraints?.filter(
        (c) => c.type === 'UNIQUE' || c.type === 'CHECK'
      );
      if (otherConstraints && otherConstraints.length > 0) {
        console.log(chalk.dim('   제약조건:'));
        for (const cons of otherConstraints) {
          const defStr = cons.definition
            ? chalk.dim(` ${cons.definition}`)
            : '';
          console.log(
            chalk.dim(`     - ${cons.name} (${cons.type}): `) +
              chalk.white(`[${cons.columns.join(', ')}]`) +
              defStr
          );
        }
      }

      console.log('');
    }

    // Show recent queries if available
    if (schema.recentQueries && schema.recentQueries.length > 0) {
      console.log(chalk.bold.blue('📊 최근 쿼리 패턴'));
      for (const q of schema.recentQueries.slice(0, 10)) {
        const truncatedQuery =
          q.query.length > 80 ? q.query.substring(0, 80) + '...' : q.query;
        console.log(
          chalk.dim(`   (${q.callCount} calls, ${q.avgTimeMs}ms avg) `) +
            chalk.white(truncatedQuery.replace(/\s+/g, ' '))
        );
      }
      console.log('');
    }
  } catch (error) {
    spinner.fail('스키마 추출 실패');
    throw error;
  }
}
