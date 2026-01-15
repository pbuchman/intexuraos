/**
 * Tests for Logger interface.
 * Verifies the interface is exported correctly.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { LOGGER_METHODS, getLogLevel, type Logger } from '../logging.js';

const originalNodeEnv = process.env['NODE_ENV'];
const originalLogLevel = process.env['LOG_LEVEL'];

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env['NODE_ENV'];
  } else {
    process.env['NODE_ENV'] = originalNodeEnv;
  }
  if (originalLogLevel === undefined) {
    delete process.env['LOG_LEVEL'];
  } else {
    process.env['LOG_LEVEL'] = originalLogLevel;
  }
});

describe('Logger interface', () => {
  it('exports expected logger methods', () => {
    expect(LOGGER_METHODS).toEqual(['info', 'warn', 'error', 'debug']);
  });

  it('is a valid interface type', () => {
    const mockLogger: Logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    };
    for (const method of LOGGER_METHODS) {
      expect(typeof mockLogger[method]).toBe('function');
    }
  });
});

describe('getLogLevel', () => {
  it('returns silent when NODE_ENV is test', () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['LOG_LEVEL'];
    expect(getLogLevel()).toBe('silent');
  });

  it('returns LOG_LEVEL when set', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['LOG_LEVEL'] = 'debug';
    expect(getLogLevel()).toBe('debug');
  });

  it('returns info as default when LOG_LEVEL not set', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['LOG_LEVEL'];
    expect(getLogLevel()).toBe('info');
  });
});
