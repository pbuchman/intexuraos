/**
 * Tests for approval intent classifier factory.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApprovalIntentClassifierFactory } from '../../../infra/llm/approvalIntentClassifierFactory.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { ok, err } from '@intexuraos/common-core';

describe('ApprovalIntentClassifierFactory', () => {
  let mockUserServiceClient: UserServiceClient;
  let mockLlmClient: LlmGenerateClient;
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLlmClient = {
      generate: vi.fn(),
    } as unknown as LlmGenerateClient;

    mockUserServiceClient = {
      getLlmClient: vi.fn(),
    } as unknown as UserServiceClient;

    mockLogger = vi.fn();
  });

  it('returns error when userServiceClient.getLlmClient fails', async () => {
    const factoryError = { code: 'NETWORK_ERROR' as const, message: 'User service error' };
    vi.mocked(mockUserServiceClient.getLlmClient).mockResolvedValue(
      err(factoryError)
    );

    const factory = createApprovalIntentClassifierFactory({
      userServiceClient: mockUserServiceClient,
    });

    const result = await factory.createForUser('user-123', mockLogger as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_ERROR');
      expect(result.error.message).toBe('User service error');
    }
  });

  it('creates classifier when userServiceClient.getLlmClient succeeds', async () => {
    vi.mocked(mockUserServiceClient.getLlmClient).mockResolvedValue(
      ok(mockLlmClient)
    );

    const factory = createApprovalIntentClassifierFactory({
      userServiceClient: mockUserServiceClient,
    });

    const result = await factory.createForUser('user-123', mockLogger as never);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.classify).toBeInstanceOf(Function);
    }
  });
});
