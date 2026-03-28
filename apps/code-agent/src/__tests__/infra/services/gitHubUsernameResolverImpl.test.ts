/**
 * Tests for GitHubUsernameResolver implementation backed by UserServiceClient.
 */

import { describe, it, expect } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import pino from 'pino';
import {
  createGitHubUsernameResolver,
  type GitHubUsernameResolverDeps,
} from '../../../infra/services/gitHubUsernameResolverImpl.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';

const logger = pino({ level: 'silent' }) as unknown as Logger;

function createMockUserServiceClient(): UserServiceClient {
  return {
    async getApiKeys(): ReturnType<UserServiceClient['getApiKeys']> {
      return ok({});
    },
    async getLlmClient(): ReturnType<UserServiceClient['getLlmClient']> {
      return err({ code: 'NO_API_KEY', message: 'mock' }) as never;
    },
    async reportLlmSuccess(): Promise<void> { return; },
    async getOAuthToken(): ReturnType<UserServiceClient['getOAuthToken']> {
      return ok({ accessToken: 'test-token', email: 'test@example.com' });
    },
    async resolveGitHubUsername(): ReturnType<UserServiceClient['resolveGitHubUsername']> {
      return ok({ userId: 'user-123' });
    },
    async getUserTimezone(): Promise<string | undefined> {
      return undefined;
    },
  };
}

describe('GitHubUsernameResolver', () => {
  it('resolves GitHub username to user ID', async () => {
    const deps: GitHubUsernameResolverDeps = {
      userServiceClient: createMockUserServiceClient(),
      logger,
    };

    const resolver = createGitHubUsernameResolver(deps);
    const result = await resolver.resolve('testuser');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('user-123');
    }
  });

  it('returns INTERNAL_ERROR when user service call fails', async () => {
    const mockClient = createMockUserServiceClient();
    mockClient.resolveGitHubUsername = async (): ReturnType<UserServiceClient['resolveGitHubUsername']> =>
      err({ code: 'NETWORK_ERROR', message: 'Service unavailable' });

    const deps: GitHubUsernameResolverDeps = {
      userServiceClient: mockClient,
      logger,
    };

    const resolver = createGitHubUsernameResolver(deps);
    const result = await resolver.resolve('testuser');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toContain('Service unavailable');
    }
  });

  it('returns NOT_FOUND when no user exists for GitHub username', async () => {
    const mockClient = createMockUserServiceClient();
    mockClient.resolveGitHubUsername = async (): ReturnType<UserServiceClient['resolveGitHubUsername']> =>
      ok(null);

    const deps: GitHubUsernameResolverDeps = {
      userServiceClient: mockClient,
      logger,
    };

    const resolver = createGitHubUsernameResolver(deps);
    const result = await resolver.resolve('unknown-user');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('unknown-user');
    }
  });
});
