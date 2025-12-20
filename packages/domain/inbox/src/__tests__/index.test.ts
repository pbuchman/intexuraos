/**
 * Tests for inbox domain module exports.
 */
import { describe, it, expect } from 'vitest';
import * as inbox from '../index.js';

describe('inbox domain module', () => {
  it('should export IngestWhatsAppMessage use case', () => {
    expect(inbox.IngestWhatsAppMessage).toBeDefined();
    expect(typeof inbox.IngestWhatsAppMessage).toBe('function');
  });

  it('should have all expected exports', () => {
    // This ensures the module is properly structured
    const exports = Object.keys(inbox);
    expect(exports).toContain('IngestWhatsAppMessage');
  });
});
