/**
 * Tests for the local Notion SDK passive health check.
 */
import { describe, expect, it } from 'vitest';
import { notionSdkHealthCheck } from '../../../infra/health/notionSdkHealthCheck.js';

describe('notionSdkHealthCheck', () => {
  it('returns a probe named "notion-sdk"', () => {
    expect(notionSdkHealthCheck().name).toBe('notion-sdk');
  });

  it('always reports ok (passive check — no per-user credentials required)', async () => {
    const outcome = await notionSdkHealthCheck().check();
    expect(outcome).toEqual({ ok: true });
  });
});
