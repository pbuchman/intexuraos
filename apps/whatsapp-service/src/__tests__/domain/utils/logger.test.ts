/**
 * Tests for Logger interface.
 */

import { describe, expect, it } from 'vitest';
import { LOGGER_METHOD_NAMES, type Logger } from '../../../domain/whatsapp/utils/logger.js';

describe('Logger interface', () => {
  it('exports expected method names', () => {
    expect(LOGGER_METHOD_NAMES).toEqual(['info', 'error']);
  });

  it('is a valid interface type', () => {
    const mockLogger: Logger = {
      info: () => undefined,
      error: () => undefined,
    };
    for (const method of LOGGER_METHOD_NAMES) {
      expect(typeof mockLogger[method]).toBe('function');
    }
  });
});
