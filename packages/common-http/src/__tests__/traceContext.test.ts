/**
 * Tests for AsyncLocalStorage-based request-id trace context.
 */

import { describe, expect, it } from 'vitest';
import {
  getCurrentRequestId,
  runWithRequestId,
  setCurrentRequestId,
} from '../http/traceContext.js';

describe('traceContext', () => {
  describe('getCurrentRequestId', () => {
    it('returns undefined when called outside any scope', () => {
      expect(getCurrentRequestId()).toBeUndefined();
    });
  });

  describe('runWithRequestId', () => {
    it('makes getCurrentRequestId return the id inside the scope (sync)', () => {
      const captured = runWithRequestId('req-abc', () => getCurrentRequestId());
      expect(captured).toBe('req-abc');
    });

    it('preserves the id across awaits inside the scope', async () => {
      const captured = await runWithRequestId('req-async', async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getCurrentRequestId();
      });
      expect(captured).toBe('req-async');
    });

    it('isolates concurrent scopes', async () => {
      const results = await Promise.all([
        runWithRequestId('req-1', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return getCurrentRequestId();
        }),
        runWithRequestId('req-2', async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return getCurrentRequestId();
        }),
        runWithRequestId('req-3', async () => {
          return getCurrentRequestId();
        }),
      ]);
      expect(results).toEqual(['req-1', 'req-2', 'req-3']);
    });

    it('returns undefined again after the scope completes', async () => {
      await runWithRequestId('req-x', () => getCurrentRequestId());
      expect(getCurrentRequestId()).toBeUndefined();
    });
  });

  describe('setCurrentRequestId', () => {
    it('makes getCurrentRequestId return the id within an enclosing scope', async () => {
      const captured = await runWithRequestId('placeholder', async () => {
        setCurrentRequestId('overridden-id');
        return getCurrentRequestId();
      });
      expect(captured).toBe('overridden-id');
    });

    it('isolates the id between two independent runWithRequestId scopes', async () => {
      const results = await Promise.all([
        runWithRequestId('outer-1', () => {
          setCurrentRequestId('inner-1');
          return getCurrentRequestId();
        }),
        runWithRequestId('outer-2', () => {
          setCurrentRequestId('inner-2');
          return getCurrentRequestId();
        }),
      ]);
      expect(results).toEqual(['inner-1', 'inner-2']);
    });
  });
});
