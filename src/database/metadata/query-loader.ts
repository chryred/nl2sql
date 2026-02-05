/**
 * 메타데이터 쿼리 로더
 *
 * @description
 * 데이터베이스 타입별 메타데이터 조회 쿼리를 YAML 파일에서 로드합니다.
 *
 * @module database/metadata/query-loader
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import type { MetadataQueryConfig } from './types.js';
import type { DatabaseType } from '../types.js';

// ESM에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 메타데이터 쿼리 파일 경로를 반환합니다.
 *
 * @param dbType - 데이터베이스 타입
 * @returns YAML 파일 경로
 */
function getQueryFilePath(dbType: DatabaseType): string {
  const filename = `${dbType}-metadata.yaml`;

  // 개발 환경: src/database/schemas/metadata/
  const devPath = join(__dirname, '..', 'schemas', 'metadata', filename);
  if (existsSync(devPath)) {
    return devPath;
  }

  // 빌드 환경: dist/database/schemas/metadata/
  const distPath = join(__dirname, '..', '..', '..', 'src', 'database', 'schemas', 'metadata', filename);
  if (existsSync(distPath)) {
    return distPath;
  }

  // 프로젝트 루트 기준
  const rootPath = join(process.cwd(), 'src', 'database', 'schemas', 'metadata', filename);
  if (existsSync(rootPath)) {
    return rootPath;
  }

  throw new Error(`Metadata query file not found for database type: ${dbType}`);
}

/**
 * 데이터베이스 타입별 메타데이터 쿼리를 로드합니다.
 *
 * @param dbType - 데이터베이스 타입 (postgresql, mysql, oracle)
 * @returns 메타데이터 쿼리 설정
 * @throws 파일이 없거나 파싱 실패 시 Error
 *
 * @example
 * const queries = loadMetadataQueries('postgresql');
 * console.log(queries.metadataSchema); // 'nl2sql'
 */
export function loadMetadataQueries(dbType: DatabaseType): MetadataQueryConfig {
  const filePath = getQueryFilePath(dbType);

  try {
    const content = readFileSync(filePath, 'utf-8');
    const config = yaml.load(content) as MetadataQueryConfig;

    if (!config || !config.queries) {
      throw new Error(`Invalid metadata query configuration for ${dbType}`);
    }

    return config;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load metadata queries for ${dbType}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * 쿼리 결과를 매핑 규칙에 따라 변환합니다.
 *
 * @param rows - 데이터베이스 쿼리 결과 행들
 * @param mapping - 컬럼명 매핑 규칙 (camelCase: snake_case)
 * @returns 변환된 객체 배열
 *
 * @example
 * const rows = [{ source_schema: 'public', source_table: 'users' }];
 * const mapping = { sourceSchema: 'source_schema', sourceTable: 'source_table' };
 * const result = mapQueryResults(rows, mapping);
 * // [{ sourceSchema: 'public', sourceTable: 'users' }]
 */
export function mapQueryResults<T>(
  rows: Record<string, unknown>[],
  mapping: Record<string, string>
): T[] {
  return rows.map((row) => {
    const mapped: Record<string, unknown> = {};

    for (const [camelKey, snakeKey] of Object.entries(mapping)) {
      // 대소문자 구분 없이 매칭 (Oracle은 대문자, PostgreSQL은 소문자)
      const actualKey = Object.keys(row).find(
        (k) => k.toLowerCase() === snakeKey.toLowerCase()
      );

      if (actualKey !== undefined) {
        let value = row[actualKey];

        // JSON 문자열을 배열로 파싱 (apply_to_schemas, exclude_tables 등)
        if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
          try {
            value = JSON.parse(value);
          } catch {
            // JSON 파싱 실패 시 원본 값 유지
          }
        }

        // Oracle의 NUMBER(1)을 boolean으로 변환
        if (
          (camelKey === 'applyPluralization' ||
            camelKey === 'includeInPrompt' ||
            camelKey === 'isRequired') &&
          typeof value === 'number'
        ) {
          value = value === 1;
        }

        mapped[camelKey] = value;
      }
    }

    return mapped as T;
  });
}

/**
 * 모든 지원 데이터베이스 타입 목록
 */
export const SUPPORTED_DB_TYPES: DatabaseType[] = ['postgresql', 'mysql', 'oracle'];

/**
 * 데이터베이스 타입이 유효한지 확인합니다.
 *
 * @param dbType - 확인할 데이터베이스 타입
 * @returns 유효한 타입이면 true
 */
export function isValidDatabaseType(dbType: string): dbType is DatabaseType {
  return SUPPORTED_DB_TYPES.includes(dbType as DatabaseType);
}
