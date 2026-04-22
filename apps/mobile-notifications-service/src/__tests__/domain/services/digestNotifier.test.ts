import { describe, it, expect } from 'vitest';
import { NoopDigestNotifier } from '../../../domain/services/digestNotifier.js';

describe('NoopDigestNotifier', () => {
  it('returns ok without publishing anything', async () => {
    const notifier = new NoopDigestNotifier();
    const result = await notifier.sendDigestReady({
      userId: 'u',
      groupKey: 'g',
      date: '2026-04-15',
      headline: 'h',
      bullets: ['b1', 'b2', 'b3'],
      messageCount: 10,
    });
    expect(result.ok).toBe(true);
  });
});
