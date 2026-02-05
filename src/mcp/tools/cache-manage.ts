/**
 * 메타데이터 캐시 관리 도구
 *
 * @description
 * 메타데이터 캐시의 상태 조회 및 새로고침 기능을 제공합니다.
 * Docker 재기동 없이 캐시를 초기화할 수 있습니다.
 *
 * @module mcp/tools/cache-manage
 */

import { z } from 'zod';
import { getConfig, validateConfig, type Config } from '../../config/index.js';
import { createConnection, closeConnection } from '../../database/connection.js';
import {
  getMetadataCacheStats,
  refreshMetadataCache,
  invalidateMetadataCache,
} from '../../database/metadata/index.js';
import { maskSensitiveInfo } from '../../errors/index.js';

/**
 * cache_status 도구의 입력 스키마
 * 파라미터 없음
 */
export const cacheStatusInputSchema = z.object({});

export type CacheStatusInput = z.infer<typeof cacheStatusInputSchema>;

/**
 * cache_status 도구의 출력 인터페이스
 */
export interface CacheStatusOutput {
  success: boolean;
  initialized: boolean;
  loadedAt: string | null;
  databaseType: string | null;
  counts: Record<string, number>;
  message?: string;
}

/**
 * 캐시 상태를 조회합니다.
 *
 * @returns 캐시 상태 정보
 */
export function cacheStatus(): CacheStatusOutput {
  const stats = getMetadataCacheStats();

  return {
    success: true,
    initialized: stats.initialized,
    loadedAt: stats.loadedAt?.toISOString() || null,
    databaseType: stats.databaseType,
    counts: stats.counts,
  };
}

/**
 * cache_refresh 도구의 입력 스키마
 */
export const cacheRefreshInputSchema = z.object({
  invalidateOnly: z
    .boolean()
    .default(false)
    .describe('If true, only invalidate cache without reloading (default: false)'),
});

export type CacheRefreshInput = z.infer<typeof cacheRefreshInputSchema>;

/**
 * cache_refresh 도구의 출력 인터페이스
 */
export interface CacheRefreshOutput {
  success: boolean;
  message: string;
  stats?: {
    initialized: boolean;
    loadedAt: string | null;
    databaseType: string | null;
    counts: Record<string, number>;
  };
  error?: string;
}

/**
 * 캐시를 새로고침합니다.
 *
 * @param input - 옵션
 * @returns 새로고침 결과
 */
export async function cacheRefresh(input: CacheRefreshInput): Promise<CacheRefreshOutput> {
  // invalidateOnly 모드
  if (input.invalidateOnly) {
    invalidateMetadataCache();
    return {
      success: true,
      message: 'Metadata cache invalidated. Will reload on next query.',
    };
  }

  // 전체 새로고침
  let config: Config;

  try {
    config = getConfig();
    validateConfig(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown configuration error';
    return {
      success: false,
      message: 'Failed to refresh cache',
      error: `Configuration error: ${maskSensitiveInfo(message)}`,
    };
  }

  try {
    const knex = createConnection(config);

    // 캐시 새로고침
    await refreshMetadataCache(knex, config.database.type);

    // 새로고침 후 상태 조회
    const stats = getMetadataCacheStats();

    return {
      success: true,
      message: 'Metadata cache refreshed successfully',
      stats: {
        initialized: stats.initialized,
        loadedAt: stats.loadedAt?.toISOString() || null,
        databaseType: stats.databaseType,
        counts: stats.counts,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: 'Failed to refresh cache',
      error: `Refresh error: ${maskSensitiveInfo(message)}`,
    };
  } finally {
    await closeConnection();
  }
}
