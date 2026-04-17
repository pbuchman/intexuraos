import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  authenticatePubSub,
  decodePubSubMessage,
} from '../../../routes/webhooks/pubsubHelpers.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const fakeReply = (): FastifyReply => {
  const reply = { fail: vi.fn().mockResolvedValue(undefined) };
  return reply as unknown as FastifyReply;
};

const fakeRequest = (overrides: {
  headers?: Record<string, string | undefined>;
  body?: unknown;
  url?: string;
}): FastifyRequest => {
  const request = {
    headers: overrides.headers ?? {},
    body: overrides.body,
    url: overrides.url ?? '/internal/code/pubsub/pr-triage',
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return request as unknown as FastifyRequest;
};

describe('authenticatePubSub', () => {
  const originalToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

  beforeEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'expected-token';
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    } else {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = originalToken;
    }
  });

  it('returns true when From header is noreply@google.com (OIDC validated by Cloud Run)', async () => {
    const request = fakeRequest({ headers: { from: 'noreply@google.com' } });
    const reply = fakeReply();

    const result = await authenticatePubSub(request, reply);

    expect(result).toBe(true);
    expect(reply.fail).not.toHaveBeenCalled();
    expect(request.log.info).toHaveBeenCalled();
  });

  it('falls back to internal-auth and returns true when token matches', async () => {
    const request = fakeRequest({
      headers: { 'x-internal-auth': 'expected-token' },
    });
    const reply = fakeReply();

    const result = await authenticatePubSub(request, reply);

    expect(result).toBe(true);
    expect(reply.fail).not.toHaveBeenCalled();
  });

  it('returns false and calls reply.fail when no auth header is present', async () => {
    const request = fakeRequest({ headers: {} });
    const reply = fakeReply();

    const result = await authenticatePubSub(request, reply);

    expect(result).toBe(false);
    expect(reply.fail).toHaveBeenCalledWith(
      'UNAUTHORIZED',
      expect.stringContaining('Internal auth failed')
    );
  });

  it('returns false when From header has a different value than noreply@google.com', async () => {
    const request = fakeRequest({ headers: { from: 'attacker@example.com' } });
    const reply = fakeReply();

    const result = await authenticatePubSub(request, reply);

    expect(result).toBe(false);
    expect(reply.fail).toHaveBeenCalled();
  });
});

describe('decodePubSubMessage', () => {
  it('decodes a valid base64 JSON envelope', () => {
    const payload = { type: 'code.pr.triage.requested', eventId: 'evt-1' };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const request = fakeRequest({
      body: { message: { data, messageId: 'm1', publishTime: 't' } },
    });

    const result = decodePubSubMessage(request);

    expect(result).toEqual({ data: payload, messageId: 'm1' });
  });

  it('returns null and logs an error when the JSON is malformed', () => {
    const data = Buffer.from('not json').toString('base64');
    const request = fakeRequest({
      body: { message: { data, messageId: 'm2', publishTime: 't' } },
    });

    const result = decodePubSubMessage(request);

    expect(result).toBeNull();
    expect(request.log.error).toHaveBeenCalled();
  });
});
