/**
 * YAML 파일 캐시 로더
 *
 * @description
 * YAML 파일을 한 번만 파싱하고 결과를 캐시합니다.
 * schema-loader, query-loader, comment-generator가 공유합니다.
 *
 * @module database/yaml-loader
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

// dist/database/ 또는 src/database/ (ts-jest 환경) 기준
const _dir = dirname(fileURLToPath(import.meta.url));

// 경로 → 파싱 결과 캐시 (프로세스 수명 동안 유지)
const _cache = new Map<string, unknown>();

/**
 * YAML 파일을 로드하고 결과를 캐싱합니다.
 *
 * @param relativePath - src/database/ 기준 상대 경로
 *                       예) 'schemas/postgresql.yaml'
 *                           'schemas/metadata/postgresql-metadata.yaml'
 * @returns 파싱된 YAML 객체
 * @throws 파일 없음(ENOENT) 또는 YAML 파싱 실패 시 에러
 */
export function loadYaml<T>(relativePath: string): T {
  if (_cache.has(relativePath)) return _cache.get(relativePath) as T;
  const absPath = join(_dir, relativePath);
  const parsed = yaml.load(readFileSync(absPath, 'utf8'));
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`Invalid YAML structure in ${relativePath}: expected object, got ${parsed === null ? 'null' : typeof parsed}`);
  }
  _cache.set(relativePath, parsed);
  return parsed as T;
}

/**
 * 캐시를 비웁니다 (테스트용).
 */
export function clearYamlCache(): void {
  _cache.clear();
}
