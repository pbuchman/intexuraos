import { describe, it, expect } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import { sha256Truncated, toDateString, computeAggregateId } from '../../../infra/firestore/aggregateKeyUtils.js';
import { createTestEvent } from '../../helpers.js';

describe('aggregateKeyUtils', () => {
  describe('sha256Truncated', () => {
    it('returns a 32-character hex string', () => {
      const result = sha256Truncated('test-value');
      expect(result).toHaveLength(32);
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('returns deterministic output for the same input', () => {
      const a = sha256Truncated('hello');
      const b = sha256Truncated('hello');
      expect(a).toBe(b);
    });

    it('returns different output for different input', () => {
      const a = sha256Truncated('hello');
      const b = sha256Truncated('world');
      expect(a).not.toBe(b);
    });
  });

  describe('toDateString', () => {
    it('extracts YYYY-MM-DD from ISO timestamp', () => {
      expect(toDateString('2026-04-10T12:30:00.000Z')).toBe('2026-04-10');
    });
  });

  describe('computeAggregateId', () => {
    it('produces a compound key with double-underscore separators', () => {
      const event = createTestEvent({
        occurredAt: '2026-04-10T15:00:00.000Z',
        owner: { type: 'user', id: 'user_abc' },
        source: { service: 'orchestrator', component: 'research', client: 'web', environment: 'dev' },
        request: { provider: LlmProviders.Anthropic, model: 'claude-sonnet-4-20250514', operation: 'generate', success: true, durationMs: 100 },
      });

      const id = computeAggregateId(event);
      const parts = id.split('__');

      expect(parts).toHaveLength(10);
      expect(parts[0]).toBe('2026-04-10');
      expect(parts[1]).toBe('user');
      expect(parts[2]).toBe(sha256Truncated('user_abc'));
      expect(parts[3]).toBe('orchestrator');
      expect(parts[4]).toBe('research');
      expect(parts[5]).toBe('web');
      expect(parts[6]).toBe(LlmProviders.Anthropic);
      expect(parts[7]).toBe(sha256Truncated('claude-sonnet-4-20250514'));
      expect(parts[8]).toBe('generate');
      expect(parts[9]).toBe('true');
    });

    it('uses false for unsuccessful requests', () => {
      const event = createTestEvent({
        request: { provider: LlmProviders.OpenAI, model: 'gpt-4o', operation: 'generate', success: false, durationMs: 100 },
      });
      const id = computeAggregateId(event);
      expect(id).toContain('__false');
    });
  });
});
