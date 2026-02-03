/**
 * errors/index.ts 유닛 테스트
 */

import {
  NL2SQLError,
  DatabaseConnectionError,
  DatabaseQueryError,
  SQLValidationError,
  SQLSecurityError,
  AIProviderError,
  ConfigurationError,
  InputValidationError,
  SchemaExtractionError,
  maskSensitiveInfo,
  getErrorMessage,
} from '../../src/errors/index.js';

describe('NL2SQLError', () => {
  it('should create error with code and user message', () => {
    const error = new NL2SQLError('Internal error', 'TEST_ERROR', 'Something went wrong');
    expect(error.message).toBe('Internal error');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.userMessage).toBe('Something went wrong');
    expect(error.name).toBe('NL2SQLError');
  });

  it('should return user message via toUserMessage()', () => {
    const error = new NL2SQLError('Internal error', 'TEST_ERROR', 'User friendly message');
    expect(error.toUserMessage()).toBe('User friendly message');
  });

  it('should serialize to JSON', () => {
    const error = new NL2SQLError('Internal error', 'TEST_ERROR', 'User message');
    const json = error.toJSON();
    expect(json.name).toBe('NL2SQLError');
    expect(json.code).toBe('TEST_ERROR');
    expect(json.message).toBe('Internal error');
    expect(json.userMessage).toBe('User message');
  });
});

describe('Specialized Error Classes', () => {
  describe('DatabaseConnectionError', () => {
    it('should have correct code and user message', () => {
      const error = new DatabaseConnectionError(
        'Connection refused',
        'localhost',
        5432,
        'testdb'
      );
      expect(error.code).toBe('DB_CONNECTION_FAILED');
      expect(error.host).toBe('localhost');
      expect(error.port).toBe(5432);
      expect(error.database).toBe('testdb');
      expect(error.toUserMessage()).toContain('database');
    });
  });

  describe('DatabaseQueryError', () => {
    it('should store query and original error', () => {
      const originalError = new Error('Syntax error');
      const error = new DatabaseQueryError(
        'Query failed',
        'SELECT * FRM users',
        originalError
      );
      expect(error.code).toBe('DB_QUERY_FAILED');
      expect(error.query).toBe('SELECT * FRM users');
      expect(error.originalError).toBe(originalError);
    });
  });

  describe('SQLValidationError', () => {
    it('should store SQL and validation reason', () => {
      const error = new SQLValidationError(
        'Invalid SQL',
        'DROP TABLE users',
        'DROP is not allowed'
      );
      expect(error.code).toBe('SQL_VALIDATION_FAILED');
      expect(error.sql).toBe('DROP TABLE users');
      expect(error.validationReason).toBe('DROP is not allowed');
    });
  });

  describe('SQLSecurityError', () => {
    it('should store detected pattern', () => {
      const error = new SQLSecurityError('Dangerous SQL', 'UNION SELECT');
      expect(error.code).toBe('SQL_SECURITY_VIOLATION');
      expect(error.pattern).toBe('UNION SELECT');
    });
  });

  describe('AIProviderError', () => {
    it('should store provider and status code', () => {
      const error = new AIProviderError(
        'API error',
        'openai',
        429,
        new Error('Rate limited')
      );
      expect(error.code).toBe('AI_PROVIDER_ERROR');
      expect(error.provider).toBe('openai');
      expect(error.statusCode).toBe(429);
    });
  });

  describe('ConfigurationError', () => {
    it('should store config key', () => {
      const error = new ConfigurationError('Missing key', 'OPENAI_API_KEY');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.configKey).toBe('OPENAI_API_KEY');
    });
  });

  describe('InputValidationError', () => {
    it('should use message as user message', () => {
      const error = new InputValidationError('Input too long', 'long input...');
      expect(error.code).toBe('INPUT_VALIDATION_FAILED');
      expect(error.input).toBe('long input...');
      expect(error.toUserMessage()).toBe('Input too long');
    });
  });

  describe('SchemaExtractionError', () => {
    it('should store table name', () => {
      const error = new SchemaExtractionError('Cannot extract', 'users');
      expect(error.code).toBe('SCHEMA_EXTRACTION_FAILED');
      expect(error.tableName).toBe('users');
    });
  });
});

describe('maskSensitiveInfo', () => {
  it('should mask OpenAI API keys', () => {
    const message = 'Key: sk-abcdefghij1234567890abcdef';
    const masked = maskSensitiveInfo(message);
    expect(masked).toContain('sk-ab***');
    expect(masked).not.toContain('1234567890');
  });

  it('should mask Anthropic API keys', () => {
    const message = 'Key: sk-ant-api03-abcdefghij1234567890';
    const masked = maskSensitiveInfo(message);
    expect(masked).toContain('sk-ant-***');
    expect(masked).not.toContain('1234567890');
  });

  it('should mask IP addresses', () => {
    const message = 'Server: 192.168.1.100:5432';
    const masked = maskSensitiveInfo(message);
    expect(masked).toContain('192.***.***');
    expect(masked).not.toContain('192.168.1.100');
  });

  it('should preserve localhost', () => {
    const message = 'Server: localhost:5432';
    const masked = maskSensitiveInfo(message);
    expect(masked).toContain('localhost');
  });

  it('should mask password patterns', () => {
    const message = 'password=mysecretpass123';
    const masked = maskSensitiveInfo(message);
    expect(masked).toContain('password=***');
    expect(masked).not.toContain('mysecretpass');
  });

  it('should mask password with quotes', () => {
    const message = 'password="mysecretpass123"';
    const masked = maskSensitiveInfo(message);
    expect(masked).toContain('password=***');
    expect(masked).not.toContain('mysecretpass');
  });

  it('should handle empty string', () => {
    expect(maskSensitiveInfo('')).toBe('');
  });

  it('should handle string without sensitive info', () => {
    const message = 'Just a normal message';
    expect(maskSensitiveInfo(message)).toBe(message);
  });
});

describe('getErrorMessage', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('in development mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should return masked message for NL2SQLError', () => {
      const error = new NL2SQLError(
        'Connection to 192.168.1.100 failed',
        'TEST',
        'User message'
      );
      const message = getErrorMessage(error);
      expect(message).toContain('***');
    });

    it('should return masked message for regular Error', () => {
      const error = new Error('Connection to 192.168.1.100 failed');
      const message = getErrorMessage(error);
      expect(message).toContain('***');
    });
  });

  describe('in production mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('should return user message for NL2SQLError', () => {
      const error = new NL2SQLError(
        'Internal details',
        'TEST',
        'User friendly message'
      );
      const message = getErrorMessage(error);
      expect(message).toBe('User friendly message');
    });

    it('should return generic message for regular Error', () => {
      const error = new Error('Internal details');
      const message = getErrorMessage(error);
      expect(message).toContain('unexpected error');
    });
  });

  it('should handle non-Error values', () => {
    const message = getErrorMessage('string error');
    expect(message).toContain('unknown error');
  });

  it('should handle null', () => {
    const message = getErrorMessage(null);
    expect(message).toContain('unknown error');
  });
});
