/**
 * Tests for retryFailedIssue use case.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  retryFailedIssue,
  type RetryFailedIssueRequest,
} from '../../../domain/useCases/retryFailedIssue.js';
import {
  FakeLinearConnectionRepository,
  FakeFailedIssueRepository,
  FakeLinearApiClient,
} from '../../fakes.js';
import type { FailedLinearIssue } from '../../../domain/models.js';

describe('retryFailedIssue', () => {
  let fakeFailedIssueRepo: FakeFailedIssueRepository;
  let fakeApiClient: FakeLinearApiClient;
  let fakeConnectionRepo: FakeLinearConnectionRepository;

  beforeEach(() => {
    fakeFailedIssueRepo = new FakeFailedIssueRepository();
    fakeApiClient = new FakeLinearApiClient();
    fakeConnectionRepo = new FakeLinearConnectionRepository();
  });

  afterEach(() => {
    fakeFailedIssueRepo.reset();
    fakeApiClient.reset();
    fakeConnectionRepo.reset();
  });

  const defaultRequest: RetryFailedIssueRequest = {
    failedIssueId: 'failed-1',
    userId: 'user-456',
  };

  function seedFailedIssue(overrides?: Partial<FailedLinearIssue>): void {
    const failedIssue: FailedLinearIssue = {
      id: 'failed-1',
      userId: 'user-456',
      actionId: 'action-1',
      originalText: 'Test action',
      extractedTitle: 'Test Issue',
      extractedPriority: 2,
      error: 'Previous error',
      reasoning: 'Test reasoning',
      createdAt: '2025-01-15T00:00:00Z',
    };
    fakeFailedIssueRepo.seedFailedIssue({ ...failedIssue, ...overrides });
  }

  function setupConnectedUser(): void {
    fakeConnectionRepo.seedConnection({
      userId: 'user-456',
      apiKey: 'linear-api-key',
      teamId: 'team-789',
      teamName: 'Engineering',
      webhookSecret: null,
      connected: true,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    });
  }

  describe('successful retry', () => {
    beforeEach(() => {
      setupConnectedUser();
      seedFailedIssue();
    });

    it('should successfully retry and create issue in Linear', async () => {
      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          status: 'success',
          issue: expect.objectContaining({
            id: expect.any(String),
            identifier: expect.any(String),
          }),
        });
      }
    });

    it('should delete failed issue after successful retry', async () => {
      await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      // Check that failed issue was deleted
      const listResult = await fakeFailedIssueRepo.listByUser('user-456');
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(0);
      }
    });

    it('should use fallback values when extractedTitle is null', async () => {
      seedFailedIssue({ extractedTitle: null, extractedPriority: null });

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
      }
    });
  });

  describe('not found scenarios', () => {
    it('should return not_found when failed issue does not exist', async () => {
      setupConnectedUser();

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ status: 'not_found' });
      }
    });

    it('should return not_found when ownership mismatch', async () => {
      setupConnectedUser();
      seedFailedIssue({ userId: 'different-user' });

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ status: 'not_found' });
      }
    });

    it('should return not_found when getById fails', async () => {
      setupConnectedUser();
      fakeFailedIssueRepo.setGetByIdFailure(true);

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      // getById failure is treated as not_found (matches route behavior)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ status: 'not_found' });
      }
    });
  });

  describe('not connected scenarios', () => {
    it('should return not_connected when user has no connection', async () => {
      seedFailedIssue();

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ status: 'not_connected' });
      }
    });

    it('should return error when getApiKey fails', async () => {
      fakeConnectionRepo.setApiKeyFailure(true);
      seedFailedIssue();

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(false);
    });

    it('should return not_connected when getApiKey returns null', async () => {
      fakeConnectionRepo.seedConnection({
        userId: 'user-456',
        apiKey: '', // Empty apiKey causes getApiKey to return null
        teamId: 'team-789',
        teamName: 'Engineering',
        webhookSecret: null,
        connected: false,
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      });
      seedFailedIssue();

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ status: 'not_connected' });
      }
    });
  });

  describe('connection scenarios', () => {
    it('should return not_connected when getFullConnection returns null', async () => {
      // Seed with connected=true so getApiKey returns the apiKey
      fakeConnectionRepo.seedConnection({
        userId: 'user-456',
        apiKey: 'some-api-key',
        teamId: 'team-789',
        teamName: 'Engineering',
        webhookSecret: null,
        connected: true, // Connected so getApiKey returns apiKey
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      });
      // But getFullConnection returns null (simulate edge case where user is connected but connection record is incomplete)
      fakeConnectionRepo.setGetFullConnectionReturnsNull(true);
      seedFailedIssue();

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ status: 'not_connected' });
      }
    });

    it('should return error when getFullConnection fails', async () => {
      // Seed with connected=true so getApiKey returns the apiKey
      fakeConnectionRepo.seedConnection({
        userId: 'user-456',
        apiKey: 'some-api-key',
        teamId: 'team-789',
        teamName: 'Engineering',
        webhookSecret: null,
        connected: true,
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      });
      // Make getFullConnection return an error
      fakeConnectionRepo.setGetFullConnectionFailure(true);
      seedFailedIssue();

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('creation failure scenarios', () => {
    beforeEach(() => {
      setupConnectedUser();
      seedFailedIssue();
    });

    it('should return creation_failed when API call fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake property
      (fakeApiClient as any).shouldFail = true;

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          status: 'creation_failed',
          errorMessage: 'Fake error',
        });
      }
    });

    it('should update error in Firestore when creation fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake property
      (fakeApiClient as any).shouldFail = true;

      await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      // Verify the update was attempted (failed issue still exists with updated error)
      const getResult = await fakeFailedIssueRepo.getById('failed-1');
      if (getResult.ok) {
        expect(getResult.value?.error).toBe('Fake error');
      }
    });

    it('should return creation_failed and log error when Firestore update fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake property
      (fakeApiClient as any).shouldFail = true;
      fakeFailedIssueRepo.setUpdateFailure(true);

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      // Should still return creation_failed even though Firestore update failed
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          status: 'creation_failed',
          errorMessage: 'Fake error',
        });
      }
    });

    it('should still return success when delete fails after creation', async () => {
      fakeFailedIssueRepo.setDeleteFailure(true);

      const result = await retryFailedIssue(defaultRequest, {
        failedIssueRepository: fakeFailedIssueRepo,
        linearApiClient: fakeApiClient,
        connectionRepository: fakeConnectionRepo,
      });

      // Still returns success even though delete failed
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
      }
    });
  });
});
