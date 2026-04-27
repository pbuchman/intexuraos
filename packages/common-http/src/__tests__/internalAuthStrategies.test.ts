/**
 * Tests for shared internal auth strategies.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  authenticateInternalScheduler,
  authenticateInternalPubSub,
} from '../auth/internalAuthStrategies.js';

function noop(): void {
  // Intentionally empty — silences logger output in tests.
}

function fakeRequest(headers: Record<string, string | undefined>): FastifyRequest {
  return {
    headers,
    log: {
      warn: noop,
      info: noop,
      error: noop,
      debug: noop,
    },
  } as unknown as FastifyRequest;
}

describe('authenticateInternalScheduler', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts a Bearer OIDC token (scheduler-oidc strategy)', () => {
    const r = authenticateInternalScheduler(fakeRequest({ authorization: 'Bearer abc.def.ghi' }));
    expect(r).toEqual({ authenticated: true, strategy: 'scheduler-oidc' });
  });

  it('falls back to internal-token via x-internal-auth header', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalScheduler(fakeRequest({ 'x-internal-auth': 'secret' }));
    expect(r).toEqual({ authenticated: true, strategy: 'internal-token' });
  });

  it('rejects when neither OIDC nor internal token is valid', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalScheduler(fakeRequest({ 'x-internal-auth': 'wrong' }));
    expect(r).toEqual({ authenticated: false });
  });

  it('rejects when no auth headers are present and env is empty', () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    const r = authenticateInternalScheduler(fakeRequest({}));
    expect(r).toEqual({ authenticated: false });
  });

  it('ignores non-Bearer authorization headers', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalScheduler(
      fakeRequest({ authorization: 'Basic xxx', 'x-internal-auth': 'wrong' })
    );
    expect(r).toEqual({ authenticated: false });
  });
});

describe('authenticateInternalPubSub', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts a Pub/Sub push (from=noreply@google.com)', () => {
    const r = authenticateInternalPubSub(fakeRequest({ from: 'noreply@google.com' }));
    expect(r).toEqual({ authenticated: true, strategy: 'pubsub-oidc' });
  });

  it('falls back to internal-token via x-internal-auth header', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalPubSub(fakeRequest({ 'x-internal-auth': 'secret' }));
    expect(r).toEqual({ authenticated: true, strategy: 'internal-token' });
  });

  it('rejects when neither Pub/Sub OIDC nor internal token is valid', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalPubSub(fakeRequest({}));
    expect(r).toEqual({ authenticated: false });
  });

  it('ignores other from-headers', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalPubSub(
      fakeRequest({ from: 'attacker@example.com', 'x-internal-auth': 'wrong' })
    );
    expect(r).toEqual({ authenticated: false });
  });
});
