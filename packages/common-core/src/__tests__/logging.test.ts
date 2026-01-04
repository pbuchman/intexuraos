/**
 * Tests for Logger interface.
 * Verifies the interface is exported correctly.
 */

import { describe, expect, it } from 'vitest';
import { LOGGER_METHODS, type Logger } from '../logging.js';

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
