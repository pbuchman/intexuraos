/**
 * Tests for Linear webhook signature validation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  validateLinearWebhookSignature,
  validateWebhookTimestamp,
} from '../../infra/linearWebhookValidation.js';

describe('validateLinearWebhookSignature', () => {
  const secret = 'test-webhook-secret';

  function generateValidSignature(body: string, signingSecret: string): string {
    return crypto.createHmac('sha256', signingSecret).update(body).digest('hex');
  }

  it('accepts valid signature', () => {
    const body = '{"action":"created","type":"AgentSessionEvent"}';
    const signature = generateValidSignature(body, secret);

    expect(validateLinearWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects invalid signature', () => {
    const body = '{"action":"created","type":"AgentSessionEvent"}';
    const signature = generateValidSignature(body, 'wrong-secret');

    expect(validateLinearWebhookSignature(body, signature, secret)).toBe(false);
  });

  it('rejects empty signature', () => {
    const body = '{"action":"created"}';

    expect(validateLinearWebhookSignature(body, '', secret)).toBe(false);
  });

  it('rejects empty secret', () => {
    const body = '{"action":"created"}';
    const signature = generateValidSignature(body, secret);

    expect(validateLinearWebhookSignature(body, signature, '')).toBe(false);
  });

  it('rejects signature with length mismatch', () => {
    const body = '{"action":"created"}';

    expect(validateLinearWebhookSignature(body, 'abc', secret)).toBe(false);
  });

  it('handles different body content correctly', () => {
    const body1 = '{"action":"created","data":{"id":"123"}}';
    const body2 = '{"action":"created","data":{"id":"456"}}';
    const sig1 = generateValidSignature(body1, secret);
    const sig2 = generateValidSignature(body2, secret);

    expect(validateLinearWebhookSignature(body1, sig1, secret)).toBe(true);
    expect(validateLinearWebhookSignature(body1, sig2, secret)).toBe(false);
    expect(validateLinearWebhookSignature(body2, sig2, secret)).toBe(true);
  });
});

describe('validateWebhookTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-19T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts current timestamp', () => {
    const now = Date.now();
    expect(validateWebhookTimestamp(now)).toBe(true);
  });

  it('accepts timestamp within 60 second window (30 seconds ago)', () => {
    const thirtySecondsAgo = Date.now() - 30_000;
    expect(validateWebhookTimestamp(thirtySecondsAgo)).toBe(true);
  });

  it('accepts timestamp exactly at 60 second boundary', () => {
    const exactlyOneMinuteAgo = Date.now() - 60_000;
    expect(validateWebhookTimestamp(exactlyOneMinuteAgo)).toBe(true);
  });

  it('rejects timestamp older than 60 seconds', () => {
    const twoMinutesAgo = Date.now() - 120_000;
    expect(validateWebhookTimestamp(twoMinutesAgo)).toBe(false);
  });

  it('accepts future timestamp within 60 second window', () => {
    const thirtySecondsInFuture = Date.now() + 30_000;
    expect(validateWebhookTimestamp(thirtySecondsInFuture)).toBe(true);
  });

  it('rejects future timestamp beyond 60 second window', () => {
    const twoMinutesInFuture = Date.now() + 120_000;
    expect(validateWebhookTimestamp(twoMinutesInFuture)).toBe(false);
  });
});
