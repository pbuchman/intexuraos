/**
 * Tests for createAppLogger function.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Writable } from 'node:stream';
import { createAppLogger } from '../appLogger.js';

vi.mock('../otelTransport.js', () => ({
  getOtelTransport: vi.fn(() => undefined),
  _resetOtelTransport: vi.fn(),
}));

import { getOtelTransport } from '../otelTransport.js';

const originalEnv = process.env;

describe('createAppLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('in test environment', () => {
    it('returns silent logger when NODE_ENV=test', () => {
      process.env['NODE_ENV'] = 'test';

      const logger = createAppLogger({ name: 'test-service' });

      expect(logger.level).toBe('silent');
    });

    it('ignores SENTRY_DSN in test environment', () => {
      process.env['NODE_ENV'] = 'test';
      process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

      const logger = createAppLogger({ name: 'test-service' });

      expect(logger.level).toBe('silent');
    });
  });

  describe('without Sentry DSN', () => {
    it('returns plain pino logger when SENTRY_DSN is not set', () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['INTEXURAOS_SENTRY_DSN'];

      const logger = createAppLogger({ name: 'dev-service' });

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('uses getLogLevel default (info) when LOG_LEVEL not set', () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['INTEXURAOS_SENTRY_DSN'];
      delete process.env['LOG_LEVEL'];

      const logger = createAppLogger({ name: 'dev-service' });

      expect(logger.level).toBe('info');
    });

    it('respects LOG_LEVEL env var', () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['INTEXURAOS_SENTRY_DSN'];
      process.env['LOG_LEVEL'] = 'debug';

      const logger = createAppLogger({ name: 'dev-service' });

      expect(logger.level).toBe('debug');
    });

    it('respects explicit level override', () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['INTEXURAOS_SENTRY_DSN'];
      process.env['LOG_LEVEL'] = 'info';

      const logger = createAppLogger({ name: 'dev-service', level: 'warn' });

      expect(logger.level).toBe('warn');
    });
  });

  describe('with Sentry DSN', () => {
    it('returns Sentry-enabled logger when SENTRY_DSN is set', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

      const logger = createAppLogger({ name: 'prod-service' });

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('uses default log level from getLogLevel', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
      delete process.env['LOG_LEVEL'];

      const logger = createAppLogger({ name: 'prod-service' });

      expect(logger.level).toBe('info');
    });

    it('respects explicit level override with Sentry', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

      const logger = createAppLogger({ name: 'prod-service', level: 'error' });

      expect(logger.level).toBe('error');
    });
  });

  describe('logger functionality', () => {
    it('creates logger with correct name', () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['INTEXURAOS_SENTRY_DSN'];

      const logger = createAppLogger({ name: 'my-named-service' });

      // Pino stores the name in bindings
      const bindings = logger.bindings();
      expect(bindings['name']).toBe('my-named-service');
    });

    it('logger can log messages without throwing', () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['INTEXURAOS_SENTRY_DSN'];

      const logger = createAppLogger({ name: 'test-service' });

      expect(() => logger.info({ foo: 'bar' }, 'test message')).not.toThrow();
      expect(() => logger.warn({ warning: true }, 'warning message')).not.toThrow();
      expect(() => logger.error({ err: new Error('test') }, 'error message')).not.toThrow();
      expect(() => logger.debug({ debug: true }, 'debug message')).not.toThrow();
    });
  });

  describe('with OTel transport', () => {
    it('creates logger with OTel transport when configured', () => {
      process.env['NODE_ENV'] = 'production';
      delete process.env['INTEXURAOS_SENTRY_DSN'];

      const mockOtelStream = new Writable({
        write(_chunk: Buffer, _encoding: string, callback: () => void): void {
          callback();
        },
      }) as unknown as NodeJS.WritableStream;
      vi.mocked(getOtelTransport).mockReturnValue(mockOtelStream);

      const logger = createAppLogger({ name: 'otel-service' });

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });

    it('logger with OTel transport can log without throwing', () => {
      process.env['NODE_ENV'] = 'production';
      delete process.env['INTEXURAOS_SENTRY_DSN'];

      const mockOtelStream = new Writable({
        write(_chunk: Buffer, _encoding: string, callback: () => void): void {
          callback();
        },
      }) as unknown as NodeJS.WritableStream;
      vi.mocked(getOtelTransport).mockReturnValue(mockOtelStream);

      const logger = createAppLogger({ name: 'otel-service' });

      expect(() => logger.info({ foo: 'bar' }, 'test otel message')).not.toThrow();
    });

    it('works with both OTel and Sentry configured', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

      const mockOtelStream = new Writable({
        write(_chunk: Buffer, _encoding: string, callback: () => void): void {
          callback();
        },
      }) as unknown as NodeJS.WritableStream;
      vi.mocked(getOtelTransport).mockReturnValue(mockOtelStream);

      const logger = createAppLogger({ name: 'otel-sentry-service' });

      expect(logger).toBeDefined();
      expect(() => logger.info('test with both')).not.toThrow();
    });
  });
});
