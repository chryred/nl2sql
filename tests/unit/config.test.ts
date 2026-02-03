/**
 * config/index.ts 유닛 테스트
 */

import { validateApiKeyFormat } from '../../src/config/index.js';

describe('validateApiKeyFormat', () => {
  describe('OpenAI API key validation', () => {
    it('should accept valid OpenAI API key format', () => {
      const validKey = 'sk-abcdefghijklmnopqrstuvwxyz123456';
      expect(validateApiKeyFormat('openai', validKey)).toBe(true);
    });

    it('should accept long OpenAI API key', () => {
      const longKey = 'sk-' + 'a'.repeat(50);
      expect(validateApiKeyFormat('openai', longKey)).toBe(true);
    });

    it('should reject OpenAI key without sk- prefix', () => {
      const invalidKey = 'abcdefghijklmnopqrstuvwxyz123456';
      expect(validateApiKeyFormat('openai', invalidKey)).toBe(false);
    });

    it('should reject too short OpenAI key', () => {
      const shortKey = 'sk-abc';
      expect(validateApiKeyFormat('openai', shortKey)).toBe(false);
    });

    it('should reject OpenAI key with invalid characters', () => {
      const invalidKey = 'sk-abc!@#$%^&*()';
      expect(validateApiKeyFormat('openai', invalidKey)).toBe(false);
    });

    it('should reject empty OpenAI key', () => {
      expect(validateApiKeyFormat('openai', '')).toBe(false);
    });
  });

  describe('Anthropic API key validation', () => {
    it('should accept valid Anthropic API key format', () => {
      const validKey = 'sk-ant-abcdefghijklmnopqrstuvwxyz1234';
      expect(validateApiKeyFormat('anthropic', validKey)).toBe(true);
    });

    it('should accept Anthropic key with hyphens', () => {
      const keyWithHyphens = 'sk-ant-api03-abcd-efgh-ijkl-mnop-qrst';
      expect(validateApiKeyFormat('anthropic', keyWithHyphens)).toBe(true);
    });

    it('should reject Anthropic key without sk-ant- prefix', () => {
      const invalidKey = 'sk-abcdefghijklmnopqrstuvwxyz123456';
      expect(validateApiKeyFormat('anthropic', invalidKey)).toBe(false);
    });

    it('should reject too short Anthropic key', () => {
      const shortKey = 'sk-ant-abc';
      expect(validateApiKeyFormat('anthropic', shortKey)).toBe(false);
    });

    it('should reject empty Anthropic key', () => {
      expect(validateApiKeyFormat('anthropic', '')).toBe(false);
    });
  });

  describe('unknown provider', () => {
    it('should return false for unknown provider', () => {
      const key = 'sk-somekey12345678901234567890';
      expect(validateApiKeyFormat('unknown' as 'openai' | 'anthropic', key)).toBe(false);
    });
  });
});
