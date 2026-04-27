import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { initiateGitHubOAuthFlow } from '../../../domain/oauth/usecases/initiateGitHubOAuthFlow.js';
import { OAuthProviders } from '../../../domain/oauth/models/OAuthConnection.js';
import type { GitHubOAuthClient } from '../../../domain/oauth/ports/GitHubOAuthClient.js';
import type { Logger } from '@intexuraos/common-core';
import { type CapturedLog, getInfoCall, getLogObj, makeFakeLogger } from './_fixtures.js';

function makeStubGitHubOAuthClient(): GitHubOAuthClient {
  return {
    generateAuthUrl: (state: string, redirectUri: string): string =>
      `https://github.com/login/oauth/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: (): never => {
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

describe('initiateGitHubOAuthFlow', () => {
  let captured: CapturedLog[];
  let logger: Logger;
  let gitHubOAuthClient: GitHubOAuthClient;

  beforeEach(() => {
    captured = [];
    logger = makeFakeLogger(captured);
    gitHubOAuthClient = makeStubGitHubOAuthClient();
  });

  it('does NOT log raw state', () => {
    const result = initiateGitHubOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GITHUB,
        redirectUri: 'https://example.com/cb',
      },
      { gitHubOAuthClient, logger }
    );

    for (const entry of captured) {
      const obj = getLogObj(entry);
      expect('state' in obj).toBe(false);
      const serialized = JSON.stringify(obj);
      expect(serialized.includes(result.state)).toBe(false);
      expect(serialized.includes(result.state.slice(0, 16))).toBe(false);
    }
  });

  it('logs a 12-char hex stateHash derived from state', () => {
    const result = initiateGitHubOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GITHUB,
        redirectUri: 'https://example.com/cb',
      },
      { gitHubOAuthClient, logger }
    );

    const second = getInfoCall(captured, 1);
    const stateHash = getLogObj(second)['stateHash'];
    expect(typeof stateHash).toBe('string');
    expect(stateHash).toMatch(/^[0-9a-f]{12}$/);
    const expected = createHash('sha256').update(result.state).digest('hex').slice(0, 12);
    expect(stateHash).toBe(expected);
  });

  it('preserves the existing first log line', () => {
    initiateGitHubOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GITHUB,
        redirectUri: 'https://example.com/cb',
      },
      { gitHubOAuthClient, logger }
    );

    const first = getInfoCall(captured, 0);
    const firstObj = getLogObj(first);
    expect(first.msg).toBe('GitHub OAuth flow initiated');
    expect(firstObj).toEqual({ userId: 'user-123', provider: OAuthProviders.GITHUB });
    expect('state' in firstObj).toBe(false);
    expect('stateHash' in firstObj).toBe(false);
  });

  it('preserves the second log message string verbatim', () => {
    initiateGitHubOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GITHUB,
        redirectUri: 'https://example.com/cb',
      },
      { gitHubOAuthClient, logger }
    );

    const second = getInfoCall(captured, 1);
    expect(second.msg).toBe('GitHub OAuth state generated for CSRF protection');
  });

  it('returned state is unchanged in shape', () => {
    const result = initiateGitHubOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GITHUB,
        redirectUri: 'https://example.com/cb',
      },
      { gitHubOAuthClient, logger }
    );

    expect(typeof result.state).toBe('string');
    expect(result.state.length).toBeGreaterThan(0);
    const decoded = JSON.parse(Buffer.from(result.state, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(decoded['userId']).toBe('user-123');
    expect(decoded['provider']).toBe(OAuthProviders.GITHUB);
    expect(decoded['redirectUri']).toBe('https://example.com/cb');
    expect(typeof decoded['createdAt']).toBe('number');
    expect(typeof decoded['nonce']).toBe('string');
    const nonce = decoded['nonce'];
    expect(typeof nonce === 'string' && nonce.length > 0).toBe(true);
  });

  it('stateHash is deterministic relative to returned state', () => {
    const result = initiateGitHubOAuthFlow(
      {
        userId: 'user-123',
        provider: OAuthProviders.GITHUB,
        redirectUri: 'https://example.com/cb',
      },
      { gitHubOAuthClient, logger }
    );

    const second = getInfoCall(captured, 1);
    const expected = createHash('sha256').update(result.state).digest('hex').slice(0, 12);
    expect(getLogObj(second)['stateHash']).toBe(expected);
  });
});
