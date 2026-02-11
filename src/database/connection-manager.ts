/**
 * 다중 연결 관리 모듈
 *
 * @description
 * MCP 다중 사용자 시나리오를 위한 연결 관리자입니다.
 * 싱글톤 패턴 대신 연결별 Knex 풀과 메타데이터 캐시를 관리합니다.
 *
 * @module database/connection-manager
 */

import { createHash } from 'crypto';
import knexLib, { type Knex } from 'knex';
import type { MetadataCache } from './metadata/types.js';
import type { DatabaseType } from './types.js';
import { loadMetadataCacheIsolated } from './metadata/index.js';
import { logger } from '../logger/index.js';
import { createPostProcessResponse } from './charset-converter.js';

/**
 * 연결 파라미터
 */
export interface ConnectionParams {
  type: DatabaseType;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  serviceName?: string;
  /** Oracle 데이터 캐릭터셋 (US7ASCII DB에서 한글 변환용, 예: ms949, euc-kr) */
  oracleDataCharset?: string;
}

/**
 * 연결 엔트리
 */
export interface ConnectionEntry {
  connectionId: string;
  params: ConnectionParams;
  knex: Knex;
  metadataCache: MetadataCache | null;
  cacheInitPromise: Promise<MetadataCache | null> | null;
  createdAt: Date;
  lastUsedAt: Date;
}

/**
 * ConnectionManager 옵션
 */
export interface ConnectionManagerOptions {
  /** 최대 동시 연결 수 (기본값: 10) */
  maxConnections?: number;
  /** 유휴 연결 TTL (밀리초, 기본값: 30분) */
  idleTtlMs?: number;
  /** 연결당 풀 최대 크기 (기본값: 5) */
  poolMax?: number;
}

/** 기본 connectionId (환경변수 기반 연결) */
export const DEFAULT_CONNECTION_ID = '__default__';

const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_POOL_MAX = 5;

/**
 * 다중 연결 관리자 클래스
 *
 * @description
 * 여러 데이터베이스 연결을 동시에 관리합니다.
 * 각 연결은 독립된 Knex 풀과 메타데이터 캐시를 가집니다.
 */
export class ConnectionManager {
  private entries = new Map<string, ConnectionEntry>();
  private options: Required<ConnectionManagerOptions>;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: ConnectionManagerOptions = {}) {
    this.options = {
      maxConnections: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
      idleTtlMs: options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS,
      poolMax: options.poolMax ?? DEFAULT_POOL_MAX,
    };

    this.cleanupInterval = setInterval(
      () => this.cleanupIdle(),
      this.options.idleTtlMs / 2
    );
    this.cleanupInterval.unref();
  }

  /**
   * 연결 파라미터로부터 결정적 connectionId를 생성합니다.
   * 비밀번호는 제외합니다.
   *
   * @param params - 연결 파라미터
   * @returns 16자 hex connectionId
   */
  static generateId(params: ConnectionParams): string {
    const key = `${params.type}:${params.host}:${params.port}:${params.database}:${params.user}`;
    return createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  /**
   * 새 연결을 등록하거나 기존 연결을 반환합니다.
   *
   * @param params - 연결 파라미터
   * @returns connectionId와 신규 여부
   */
  register(
    params: ConnectionParams
  ): { connectionId: string; isNew: boolean } {
    const connectionId = ConnectionManager.generateId(params);

    if (this.entries.has(connectionId)) {
      const entry = this.entries.get(connectionId)!;
      entry.lastUsedAt = new Date();
      return { connectionId, isNew: false };
    }

    if (this.entries.size >= this.options.maxConnections) {
      this.evictOldest();
      if (this.entries.size >= this.options.maxConnections) {
        throw new Error(
          `Maximum connections (${this.options.maxConnections}) reached. Disconnect unused connections first.`
        );
      }
    }

    const knexInstance = this.createKnexInstance(params);

    const entry: ConnectionEntry = {
      connectionId,
      params,
      knex: knexInstance,
      metadataCache: null,
      cacheInitPromise: null,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };

    this.entries.set(connectionId, entry);
    logger.info(
      `Connection registered: ${connectionId} (${params.type}://${params.host}:${params.port}/${params.database})`
    );
    return { connectionId, isNew: true };
  }

  /**
   * 환경변수 기반 기본 연결을 등록합니다.
   *
   * @param params - 연결 파라미터
   * @returns 기본 connectionId
   */
  registerDefault(params: ConnectionParams): string {
    const knexInstance = this.createKnexInstance(params);

    const entry: ConnectionEntry = {
      connectionId: DEFAULT_CONNECTION_ID,
      params,
      knex: knexInstance,
      metadataCache: null,
      cacheInitPromise: null,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };

    this.entries.set(DEFAULT_CONNECTION_ID, entry);
    logger.info('Default connection registered from environment variables');
    return DEFAULT_CONNECTION_ID;
  }

  /**
   * connectionId로 연결 엔트리를 조회합니다.
   *
   * @param connectionId - 연결 식별자
   * @returns 연결 엔트리 또는 undefined
   */
  getEntry(connectionId: string): ConnectionEntry | undefined {
    const entry = this.entries.get(connectionId);
    if (entry) {
      entry.lastUsedAt = new Date();
    }
    return entry;
  }

  /**
   * 기본 연결을 반환합니다.
   * __default__ 엔트리가 있으면 반환, 없으면 유일한 엔트리를 반환합니다.
   *
   * @returns 기본 연결 엔트리 또는 undefined
   */
  getDefault(): ConnectionEntry | undefined {
    if (this.entries.has(DEFAULT_CONNECTION_ID)) {
      return this.getEntry(DEFAULT_CONNECTION_ID);
    }
    if (this.entries.size === 1) {
      const [entry] = this.entries.values();
      entry.lastUsedAt = new Date();
      return entry;
    }
    return undefined;
  }

  /**
   * connectionId로 연결을 해석합니다.
   * connectionId가 제공되면 해당 엔트리, 없으면 기본 연결을 반환합니다.
   *
   * @param connectionId - 선택적 연결 식별자
   * @returns 연결 엔트리 또는 undefined
   */
  resolve(connectionId?: string): ConnectionEntry | undefined {
    if (connectionId) {
      return this.getEntry(connectionId);
    }
    return this.getDefault();
  }

  /**
   * 연결의 메타데이터 캐시를 초기화하거나 기존 캐시를 반환합니다.
   * 동시 호출을 중복 방지합니다.
   *
   * @param connectionId - 연결 식별자
   * @returns 메타데이터 캐시 또는 null
   */
  async getOrInitCache(
    connectionId: string
  ): Promise<MetadataCache | null> {
    const entry = this.entries.get(connectionId);
    if (!entry) return null;

    if (entry.metadataCache) return entry.metadataCache;

    if (entry.cacheInitPromise) return entry.cacheInitPromise;

    entry.cacheInitPromise = loadMetadataCacheIsolated(
      entry.knex,
      entry.params.type
    )
      .then((cache) => {
        entry.metadataCache = cache;
        entry.cacheInitPromise = null;
        return cache;
      })
      .catch((err) => {
        entry.cacheInitPromise = null;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `Failed to init metadata cache for ${connectionId}: ${msg}`
        );
        return null;
      });

    return entry.cacheInitPromise;
  }

  /**
   * 연결의 메타데이터 캐시를 새로고침합니다.
   *
   * @param connectionId - 연결 식별자
   * @returns 새로 로드된 메타데이터 캐시 또는 null
   */
  async refreshCache(
    connectionId: string
  ): Promise<MetadataCache | null> {
    const entry = this.entries.get(connectionId);
    if (!entry) return null;

    entry.metadataCache = null;
    entry.cacheInitPromise = null;
    return this.getOrInitCache(connectionId);
  }

  /**
   * 연결의 메타데이터 캐시를 무효화합니다.
   *
   * @param connectionId - 연결 식별자
   */
  invalidateCache(connectionId: string): void {
    const entry = this.entries.get(connectionId);
    if (entry) {
      entry.metadataCache = null;
      entry.cacheInitPromise = null;
    }
  }

  /**
   * 연결의 메타데이터 캐시 통계를 반환합니다.
   *
   * @param connectionId - 연결 식별자
   * @returns 캐시 통계
   */
  getCacheStats(connectionId: string): {
    initialized: boolean;
    loadedAt: Date | null;
    databaseType: string | null;
    counts: Record<string, number>;
  } {
    const entry = this.entries.get(connectionId);
    if (!entry || !entry.metadataCache) {
      return {
        initialized: false,
        loadedAt: null,
        databaseType: null,
        counts: {},
      };
    }

    const cache = entry.metadataCache;
    return {
      initialized: true,
      loadedAt: cache.loadedAt,
      databaseType: cache.databaseType,
      counts: {
        relationships: cache.relationships.length,
        namingConventions: cache.namingConventions.length,
        codeTables: cache.codeTables.length,
        columnCodeMappings: cache.columnCodeMappings.length,
        codeAliases: cache.codeAliases.length,
        glossaryTerms: cache.glossaryTerms.length,
        glossaryAliases: cache.glossaryAliases.length,
        glossaryContexts: cache.glossaryContexts.length,
        queryPatterns: cache.queryPatterns.length,
        patternParameters: cache.patternParameters.length,
        patternKeywords: cache.patternKeywords.length,
      },
    };
  }

  /**
   * 연결을 해제하고 제거합니다.
   *
   * @param connectionId - 연결 식별자
   * @returns 성공 여부
   */
  async disconnect(connectionId: string): Promise<boolean> {
    const entry = this.entries.get(connectionId);
    if (!entry) return false;

    await entry.knex.destroy();
    this.entries.delete(connectionId);
    logger.info(`Connection disconnected: ${connectionId}`);
    return true;
  }

  /**
   * 활성 연결 목록을 반환합니다 (비밀번호 제외).
   *
   * @returns 연결 정보 배열
   */
  listConnections(): Array<{
    connectionId: string;
    type: string;
    host: string;
    port: number;
    database: string;
    user: string;
    createdAt: string;
    lastUsedAt: string;
    hasCachedMetadata: boolean;
  }> {
    return Array.from(this.entries.values()).map((e) => ({
      connectionId: e.connectionId,
      type: e.params.type,
      host: e.params.host,
      port: e.params.port,
      database: e.params.database,
      user: e.params.user,
      createdAt: e.createdAt.toISOString(),
      lastUsedAt: e.lastUsedAt.toISOString(),
      hasCachedMetadata: e.metadataCache !== null,
    }));
  }

  /**
   * 등록된 연결 수를 반환합니다.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * 모든 연결을 해제하고 정리합니다.
   */
  async destroyAll(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const destroyPromises: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      destroyPromises.push(entry.knex.destroy());
    }
    await Promise.all(destroyPromises);
    this.entries.clear();
    logger.info('All connections destroyed');
  }

  /**
   * Knex 인스턴스를 생성합니다.
   */
  private createKnexInstance(params: ConnectionParams): Knex {
    const client = this.getKnexClient(params.type);
    const knexConfig: Knex.Config = {
      client,
      connection: this.getConnectionConfig(params),
      pool: { min: 0, max: this.options.poolMax },
    };

    // Oracle US7ASCII 등 레거시 캐릭터셋 환경에서 한글 변환
    if (params.type === 'oracle' && params.oracleDataCharset) {
      knexConfig.postProcessResponse = createPostProcessResponse(
        params.oracleDataCharset
      );
    }

    return knexLib(knexConfig);
  }

  /**
   * DBMS에 맞는 Knex 클라이언트명을 반환합니다.
   */
  private getKnexClient(dbType: DatabaseType): string {
    switch (dbType) {
      case 'mysql':
        return 'mysql2';
      case 'oracle':
        return 'oracledb';
      default:
        return 'pg';
    }
  }

  /**
   * 연결 설정을 생성합니다.
   */
  private getConnectionConfig(
    params: ConnectionParams
  ): Knex.Config['connection'] {
    if (params.type === 'oracle') {
      const connectString = params.serviceName
        ? `${params.host}:${params.port}/${params.serviceName}`
        : `${params.host}:${params.port}/${params.database}`;
      return {
        user: params.user,
        password: params.password,
        connectString,
      };
    }

    return {
      host: params.host,
      port: params.port,
      user: params.user,
      password: params.password,
      database: params.database,
    };
  }

  /**
   * 가장 오래된 유휴 연결을 제거합니다.
   */
  private evictOldest(): void {
    let oldest: ConnectionEntry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.connectionId === DEFAULT_CONNECTION_ID) continue;
      if (!oldest || entry.lastUsedAt < oldest.lastUsedAt) {
        oldest = entry;
      }
    }
    if (oldest) {
      oldest.knex.destroy().catch(() => {});
      this.entries.delete(oldest.connectionId);
      logger.info(`Evicted oldest connection: ${oldest.connectionId}`);
    }
  }

  /**
   * TTL이 만료된 유휴 연결을 정리합니다.
   */
  private cleanupIdle(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (id === DEFAULT_CONNECTION_ID) continue;
      if (now - entry.lastUsedAt.getTime() > this.options.idleTtlMs) {
        entry.knex.destroy().catch(() => {});
        this.entries.delete(id);
        logger.info(`Evicted idle connection: ${id}`);
      }
    }
  }
}
