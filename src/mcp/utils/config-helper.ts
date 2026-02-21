/**
 * Configuration helper utilities
 *
 * @description
 * Shared utilities for building configuration objects from connection entries.
 *
 * @module mcp/utils/config-helper
 */

import { getAIConfig, type Config } from '../../config/index.js';

/**
 * Builds a Config object from a ConnectionEntry.
 *
 * @param entry - Connection entry with database parameters
 * @returns Configuration object with AI and database settings
 */
export function buildConfigFromEntry(entry: {
  params: {
    type: 'postgresql' | 'mysql' | 'oracle';
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    serviceName?: string;
  };
}): Config {
  const aiConfig = getAIConfig();
  return {
    ai: aiConfig,
    database: {
      type: entry.params.type,
      host: entry.params.host,
      port: entry.params.port,
      user: entry.params.user,
      password: entry.params.password,
      database: entry.params.database,
      serviceName: entry.params.serviceName,
    },
  };
}
