import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { sendMessageDigestRouteError } from './routeErrors.js';

describe('Message Digest route error mapping', () => {
  it.each([
    'INVALID_REQUEST',
    'INVALID_SCHEDULE',
    'INVALID_QUERY',
    'INVALID_CURSOR',
    'SOURCE_TOO_LARGE',
  ])('maps %s to a privacy-safe invalid request response', async (code) => {
    const { reply, fail } = fakeReply();

    await sendMessageDigestRouteError(reply, code);

    expect(fail).toHaveBeenCalledWith(
      'INVALID_REQUEST',
      'Invalid Message Digest request',
      undefined,
      expect.objectContaining({
        reason: code,
        ...(code === 'INVALID_CURSOR' ? { restartPagination: true } : {}),
      })
    );
  });

  it.each([
    ['NOT_FOUND', 'NOT_FOUND', 'Message Digest not found'],
    ['SOURCE_NOT_FOUND', 'NOT_FOUND', 'WhatsApp chat not found'],
    ['SOURCE_UNAVAILABLE', 'DOWNSTREAM_ERROR', 'WhatsApp is temporarily unavailable'],
    ['READINESS_UNAVAILABLE', 'DOWNSTREAM_ERROR', 'WhatsApp is temporarily unavailable'],
    ['LLM_UNAVAILABLE', 'DOWNSTREAM_ERROR', 'Message Digest preview is temporarily unavailable'],
    ['INVALID_AGGREGATE', 'DOWNSTREAM_ERROR', 'Message Digest preview is temporarily unavailable'],
  ])('maps %s without leaking a downstream reason', async (code, publicCode, message) => {
    const { reply, fail } = fakeReply();

    await sendMessageDigestRouteError(reply, code);

    expect(fail).toHaveBeenCalledWith(publicCode, message);
  });

  it('maps state conflicts to an explicit refresh instruction', async () => {
    const { reply, fail } = fakeReply();

    await sendMessageDigestRouteError(reply, 'RUN_PREPARATION_STALE');

    expect(fail).toHaveBeenCalledWith(
      'CONFLICT',
      'Message Digest state changed; refresh and retry',
      undefined,
      { reason: 'RUN_PREPARATION_STALE', refreshRequired: true }
    );
  });

  it('maps a changed WhatsApp source without exposing source identity', async () => {
    const { reply, fail } = fakeReply();

    await sendMessageDigestRouteError(reply, 'SOURCE_CHANGED');

    expect(fail).toHaveBeenCalledWith(
      'CONFLICT',
      'Message Digest state changed; refresh and retry',
      undefined,
      { reason: 'SOURCE_CHANGED', refreshRequired: true }
    );
    expect(JSON.stringify(fail.mock.calls)).not.toContain('synthetic-account');
  });
});

function fakeReply(): { reply: FastifyReply; fail: ReturnType<typeof vi.fn> } {
  const fail = vi.fn(async () => undefined);
  return { reply: { fail } as unknown as FastifyReply, fail };
}
