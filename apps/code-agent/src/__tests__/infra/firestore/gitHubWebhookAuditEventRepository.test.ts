import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

import { getFirestore } from '@intexuraos/infra-firestore';
import { createFirestoreGitHubWebhookAuditEventRepository } from '../../../infra/firestore/gitHubWebhookAuditEventRepository.js';

const mockGetFirestore = vi.mocked(getFirestore);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

describe('createFirestoreGitHubWebhookAuditEventRepository', () => {
  it('saves an auth-passed webhook audit event', async () => {
    const mockDocRef = {
      set: vi.fn().mockResolvedValue(undefined),
      id: 'audit-1',
    };

    const mockCollection = {
      doc: vi.fn().mockReturnValue(mockDocRef),
      where: vi.fn(),
    };

    mockGetFirestore.mockReturnValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    } as never);

    const repo = createFirestoreGitHubWebhookAuditEventRepository({ logger: mockLogger });
    const result = await repo.save({
      deliveryId: 'delivery-1',
      githubEventName: 'pull_request',
      eventType: 'pull_request',
      action: 'opened',
      repository: 'intexuraos/test-repo',
      repositoryId: 100,
      pullRequestNumber: 42,
      pullRequestId: 4200,
      senderLogin: 'octocat',
      senderId: 1,
      senderType: 'User',
      authPassedAt: new Date('2026-03-12T10:00:00.000Z'),
      receivedAt: new Date('2026-03-12T10:00:00.000Z'),
      normalizationStatus: 'pending',
      payload: { action: 'opened' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('audit-1');
      expect(result.value.deliveryId).toBe('delivery-1');
      expect(result.value.eventType).toBe('pull_request');
      expect(result.value.action).toBe('opened');
    }
  });

  it('updates the audit event normalization status', async () => {
    const authPassedAt = new Date('2026-03-12T10:00:00.000Z');
    const receivedAt = new Date('2026-03-12T10:00:00.000Z');
    const mockSnapshot = {
      exists: true,
      id: 'audit-1',
      data: vi.fn().mockReturnValue({
        deliveryId: 'delivery-1',
        githubEventName: 'pull_request',
        eventType: 'pull_request',
        action: 'opened',
        repository: 'intexuraos/test-repo',
        repositoryId: 100,
        pullRequestNumber: 42,
        pullRequestId: 4200,
        senderLogin: 'octocat',
        senderId: 1,
        senderType: 'User',
        authPassedAt,
        receivedAt,
        normalizationStatus: 'normalized',
        payload: { action: 'opened' },
      }),
    };
    const mockDocRef = {
      update: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(mockSnapshot),
      id: 'audit-1',
    };
    const mockCollection = {
      doc: vi.fn().mockReturnValue(mockDocRef),
      where: vi.fn(),
    };

    mockGetFirestore.mockReturnValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    } as never);

    const repo = createFirestoreGitHubWebhookAuditEventRepository({ logger: mockLogger });
    const result = await repo.updateNormalizationStatus({
      id: 'audit-1',
      normalizationStatus: 'normalized',
    });

    expect(mockDocRef.update).toHaveBeenCalledWith({
      normalizationStatus: 'normalized',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('audit-1');
      expect(result.value.normalizationStatus).toBe('normalized');
    }
  });

  it('finds audit events by id, skips missing docs, and normalizes Firestore date shapes', async () => {
    const snapshotById = new Map<string, {
      exists: boolean;
      id: string;
      data?: () => Record<string, unknown>;
    }>([
      ['audit-date', {
        exists: true,
        id: 'audit-date',
        data: (): Record<string, unknown> => ({
          deliveryId: 'delivery-date',
          githubEventName: 'pull_request',
          eventType: 'pull_request',
          action: 'opened',
          repository: 'intexuraos/test-repo',
          repositoryId: 100,
          pullRequestNumber: 42,
          pullRequestId: 4200,
          senderLogin: 'octocat',
          senderId: 1,
          senderType: 'User',
          authPassedAt: new Date('2026-03-12T10:00:00.000Z'),
          receivedAt: new Date('2026-03-12T10:00:00.000Z'),
          normalizationStatus: 'normalized',
          payload: { action: 'opened' },
        }),
      }],
      ['audit-missing', {
        exists: false,
        id: 'audit-missing',
      }],
      ['audit-ts', {
        exists: true,
        id: 'audit-ts',
        data: (): Record<string, unknown> => ({
          deliveryId: 'delivery-ts',
          githubEventName: 'issue_comment',
          eventType: 'issue_comment',
          action: 'created',
          repository: 'intexuraos/test-repo',
          repositoryId: 101,
          pullRequestNumber: 43,
          pullRequestId: 4300,
          senderLogin: 'octocat',
          senderId: 2,
          senderType: 'Bot',
          authPassedAt: { toDate: () => new Date('2026-03-12T10:01:00.000Z') },
          receivedAt: { toDate: () => new Date('2026-03-12T10:01:00.000Z') },
          normalizationStatus: 'ignored',
          payload: { action: 'created' },
        }),
      }],
      ['audit-string', {
        exists: true,
        id: 'audit-string',
        data: (): Record<string, unknown> => ({
          deliveryId: 'delivery-string',
          githubEventName: 'unknown',
          eventType: 'unknown',
          action: null,
          repository: null,
          repositoryId: null,
          pullRequestNumber: null,
          pullRequestId: null,
          senderLogin: null,
          senderId: null,
          senderType: null,
          authPassedAt: '2026-03-12T10:02:00.000Z',
          receivedAt: '2026-03-12T10:02:00.000Z',
          normalizationStatus: 'unsupported',
          payload: {},
        }),
      }],
    ]);

    const mockCollection = {
      doc: vi.fn().mockImplementation((id: string): { get: ReturnType<typeof vi.fn> } => ({
        get: vi.fn().mockResolvedValue(snapshotById.get(id)),
      })),
      where: vi.fn(),
    };

    mockGetFirestore.mockReturnValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    } as never);

    const repo = createFirestoreGitHubWebhookAuditEventRepository({ logger: mockLogger });
    const result = await repo.findByIds(['audit-date', 'audit-missing', 'audit-ts', 'audit-string']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      expect(result.value.map((event) => event.id)).toEqual(['audit-date', 'audit-ts', 'audit-string']);
      expect(result.value.map((event) => event.authPassedAt.toISOString())).toEqual([
        '2026-03-12T10:00:00.000Z',
        '2026-03-12T10:01:00.000Z',
        '2026-03-12T10:02:00.000Z',
      ]);
      expect(result.value.map((event) => event.receivedAt.toISOString())).toEqual([
        '2026-03-12T10:00:00.000Z',
        '2026-03-12T10:01:00.000Z',
        '2026-03-12T10:02:00.000Z',
      ]);
    }
  });

  it('returns FIRESTORE_ERROR when updating normalization status for a missing audit event', async () => {
    const mockSnapshot = {
      exists: false,
    };
    const mockDocRef = {
      update: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(mockSnapshot),
      id: 'audit-missing',
    };
    const mockCollection = {
      doc: vi.fn().mockReturnValue(mockDocRef),
      where: vi.fn(),
    };

    mockGetFirestore.mockReturnValue({
      collection: vi.fn().mockReturnValue(mockCollection),
    } as never);

    const repo = createFirestoreGitHubWebhookAuditEventRepository({ logger: mockLogger });
    const result = await repo.updateNormalizationStatus({
      id: 'audit-missing',
      normalizationStatus: 'failed',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FIRESTORE_ERROR');
      expect(result.error.message).toBe('Missing GitHub webhook audit event: audit-missing');
    }
  });
});
