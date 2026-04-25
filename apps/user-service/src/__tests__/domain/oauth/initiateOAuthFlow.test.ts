import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { initiateOAuthFlow } from '../../../domain/oauth/usecases/initiateOAuthFlow.js';
import { OAuthProviders } from '../../../domain/oauth/models/OAuthConnection.js';
import type { GoogleOAuthClient } from '../../../domain/oauth/ports/GoogleOAuthClient.js';
import type { Logger } from '@intexuraos/common-core';

interface CapturedLog {
  method: string;
  obj: Record<string, unknown>;
  msg?: string;
}

function makeFakeLogger(captured: CapturedLog[]): Logger {
  const push = (method: string, obj: object, msg?: string): void => {
    const entry: CapturedLog = { method, obj: obj as Record<string, unknown> };
    if (msg !== undefined) {
      entry.msg = msg;
    }
    captured.push(entry);
  };
  return {
    info: (obj: object, msg?: string): void => push('info', obj, msg),
    warn: (obj: object, msg?: string): void => push('warn', obj, msg),
    error: (obj: object, msg?: string): void => push('error', obj, msg),
    debug: (obj: object, msg?: string): void => push('debug', obj, msg),
  };
}

function makeStubGoogleOAuthClient(): GoogleOAuthClient {
  return {
    generateAuthUrl: (state: string, redirectUri: string): string =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: (): never => {
      throw new Error('not used');
    },
    refreshAccessToken: (): never => {
      throw new Error('not used');
    },
    getUserInfo: (): never => {
      throw new Error('not used');
    },
    revokeToken: (): never => {
      throw new Error('not used');
    },
  };
}

function getInfoCall(captured: CapturedLog[], index: number): CapturedLog {
  const infoCalls = captured.filter((c) => c.method === 'info');
  const entry = infoCalls[index];
  if (entry === undefined) {
    throw new Error(`expected info call at index ${String(index)}`);
  }
  return entry;
}

describe('initiateOAuthFlow', () => {
  let captured: CapturedLog[];
  let logger: Logger;
  let googleOAuthClient: GoogleOAuthClient;

  beforeEach(() => {
    captured = [];
    logger = makeFakeLogger(captured);
    googleOAuthClient = makeStubGoogleOAuthClient();
  });

  it('does NOT log raw state', () => {
    const result = initiateOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GOOGLE,
        redirectUri: 'https://example.com/cb',
      },
      { googleOAuthClient, logger }
    );

    for (const entry of captured) {
      expect('state' in entry.obj).toBe(false);
      const serialized = JSON.stringify(entry.obj);
      expect(serialized.includes(result.state)).toBe(false);
      expect(serialized.includes(result.state.slice(0, 16))).toBe(false);
    }
  });

  it('logs a 12-char hex stateHash derived from state', () => {
    const result = initiateOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GOOGLE,
        redirectUri: 'https://example.com/cb',
      },
      { googleOAuthClient, logger }
    );

    const second = getInfoCall(captured, 1);
    const stateHash = second.obj['stateHash'];
    expect(typeof stateHash).toBe('string');
    expect(stateHash).toMatch(/^[0-9a-f]{12}$/);
    const expected = createHash('sha256').update(result.state).digest('hex').slice(0, 12);
    expect(stateHash).toBe(expected);
  });

  it('preserves the existing first log line', () => {
    initiateOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GOOGLE,
        redirectUri: 'https://example.com/cb',
      },
      { googleOAuthClient, logger }
    );

    const first = getInfoCall(captured, 0);
    expect(first.msg).toBe('OAuth flow initiated');
    expect(first.obj).toEqual({ userId: 'user-123', provider: OAuthProviders.GOOGLE });
    expect('state' in first.obj).toBe(false);
    expect('stateHash' in first.obj).toBe(false);
  });

  it('preserves the second log message string verbatim', () => {
    initiateOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GOOGLE,
        redirectUri: 'https://example.com/cb',
      },
      { googleOAuthClient, logger }
    );

    const second = getInfoCall(captured, 1);
    expect(second.msg).toBe('OAuth state generated for CSRF protection');
  });

  it('returned state is unchanged in shape', () => {
    const result = initiateOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GOOGLE,
        redirectUri: 'https://example.com/cb',
      },
      { googleOAuthClient, logger }
    );

    expect(typeof result.state).toBe('string');
    expect(result.state.length).toBeGreaterThan(0);
    const decoded = JSON.parse(Buffer.from(result.state, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(decoded['userId']).toBe('user-123');
    expect(decoded['provider']).toBe(OAuthProviders.GOOGLE);
    expect(decoded['redirectUri']).toBe('https://example.com/cb');
    expect(typeof decoded['createdAt']).toBe('number');
    expect(typeof decoded['nonce']).toBe('string');
    const nonce = decoded['nonce'];
    expect(typeof nonce === 'string' && nonce.length > 0).toBe(true);
  });

  it('stateHash is deterministic relative to returned state', () => {
    const result = initiateOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GOOGLE,
        redirectUri: 'https://example.com/cb',
      },
      { googleOAuthClient, logger }
    );

    const second = getInfoCall(captured, 1);
    const expected = createHash('sha256').update(result.state).digest('hex').slice(0, 12);
    expect(second.obj['stateHash']).toBe(expected);
  });
});
