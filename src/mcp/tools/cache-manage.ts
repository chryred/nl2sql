/**
 * 메타데이터 캐시 관리 도구
 *
 * @description
 * 메타데이터 캐시의 상태 조회 및 새로고침 기능을 제공합니다.
 * ConnectionManager를 통해 연결별 캐시를 관리합니다.
 *
 * @module mcp/tools/cache-manage
 */

import { z } from 'zod';
import { getConfig, validateConfig, type Config } from '../../config/index.js';
import {
  createConnection,
  closeConnection,
} from '../../database/connection.js';
import {
  getMetadataCacheStats,
  refreshMetadataCache,
  invalidateMetadataCache,
} from '../../database/metadata/index.js';
import { maskSensitiveInfo } from '../../errors/index.js';
import type { ConnectionManager } from '../../database/connection-manager.js';

/**
 * cache_status 도구의 입력 스키마
 */
export const cacheStatusInputSchema = z.object({
  connectionId: z
    .string()
    .optional()
    .describe(
      'Connection ID to check cache for (optional, uses default if omitted)'
    ),
});

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
  connectionId?: string;
  message?: string;
}

/**
 * 캐시 상태를 조회합니다.
 *
 * @param input - 선택적 connectionId
 * @param connManager - ConnectionManager 인스턴스
 * @returns 캐시 상태 정보
 */
export function cacheStatus(
  input: CacheStatusInput,
  connManager: ConnectionManager
): CacheStatusOutput {
  const entry = connManager.resolve(input.connectionId);

  if (entry) {
    const stats = connManager.getCacheStats(entry.connectionId);
    return {
      success: true,
      initialized: stats.initialized,
      loadedAt: stats.loadedAt?.toISOString() || null,
      databaseType: stats.databaseType,
      counts: stats.counts,
      connectionId: entry.connectionId,
    };
  }

  // Legacy 폴백: 전역 싱글톤 캐시
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
    .describe(
      'If true, only invalidate cache without reloading (default: false)'
    ),
  connectionId: z
    .string()
    .optional()
    .describe(
      'Connection ID to refresh cache for (optional, uses default if omitted)'
    ),
});

export type CacheRefreshInput = z.infer<typeof cacheRefreshInputSchema>;

/**
 * cache_refresh 도구의 출력 인터페이스
 */
export interface CacheRefreshOutput {
  success: boolean;
  message: string;
  connectionId?: string;
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
 * @param connManager - ConnectionManager 인스턴스
 * @returns 새로고침 결과
 */
export async function cacheRefresh(
  input: CacheRefreshInput,
  connManager: ConnectionManager
): Promise<CacheRefreshOutput> {
  const entry = connManager.resolve(input.connectionId);

  if (entry) {
    // ConnectionManager 경로
    if (input.invalidateOnly) {
      connManager.invalidateCache(entry.connectionId);
      return {
        success: true,
        message: 'Metadata cache invalidated for connection. Will reload on next query.',
        connectionId: entry.connectionId,
      };
    }

    try {
      await connManager.refreshCache(entry.connectionId);
      const stats = connManager.getCacheStats(entry.connectionId);

      return {
        success: true,
        message: 'Metadata cache refreshed successfully',
        connectionId: entry.connectionId,
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
        connectionId: entry.connectionId,
        error: `Refresh error: ${maskSensitiveInfo(message)}`,
      };
    }
  }

  // Legacy 폴백: 환경변수 기반
  return cacheRefreshLegacy(input);
}

/**
 * 환경변수 기반 레거시 경로 (하위 호환).
 */
async function cacheRefreshLegacy(
  input: CacheRefreshInput
): Promise<CacheRefreshOutput> {
  if (input.invalidateOnly) {
    invalidateMetadataCache();
    return {
      success: true,
      message: 'Metadata cache invalidated. Will reload on next query.',
    };
  }

  let config: Config;

  try {
    config = getConfig();
    validateConfig(config);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown configuration error';
    return {
      success: false,
      message: 'Failed to refresh cache',
      error: `Configuration error: ${maskSensitiveInfo(message)}`,
    };
  }

  try {
    const knex = createConnection(config);
    await refreshMetadataCache(knex, config.database.type);

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
