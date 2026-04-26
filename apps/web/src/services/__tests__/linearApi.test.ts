/**
 * Tests for linearApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLinearConnection,
  validateLinearApiKey,
  saveLinearConnection,
  disconnectLinear,
  listLinearIssues,
  listFailedLinearIssues,
  deleteFailedIssue,
  retryFailedIssue,
  validateLinearIssue,
  generateLinearIssueTitle,
  syncFromLinear,
  getWebhookConfig,
  saveWebhookSecret,
  removeWebhookSecret,
  listPruneCandidates,
  deletePruneCandidates,
} from '../linearApi.js';
import { ApiError } from '../apiClient.js';

vi.mock('../apiClient.js', async () => {
  const actual = await vi.importActual<typeof import('../apiClient.js')>('../apiClient.js');
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

vi.mock('../../config', () => ({
  config: {
    linearAgentUrl: 'https://linear.test',
  },
}));

const TOKEN = 'tok';

describe('linearApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getLinearConnection', () => {
    it('returns connection on happy path', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const conn = { connected: true, teamId: 't', teamName: 'Team' };
      vi.mocked(apiRequest).mockResolvedValue(conn);

      const result = await getLinearConnection(TOKEN);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[0]).toBe('https://linear.test');
      expect(call?.[1]).toBe('/linear/connection');
      expect(result).toBe(conn);
    });

    it('returns null on 403 ApiError', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new ApiError('FORBIDDEN', 'no access', 403));

      const result = await getLinearConnection(TOKEN);

      expect(result).toBeNull();
    });

    it('rethrows non-403 ApiError', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new ApiError('SERVER', 'oops', 500));

      await expect(getLinearConnection(TOKEN)).rejects.toThrow(ApiError);
    });
  });

  describe('validateLinearApiKey', () => {
    it('POSTs apiKey and unwraps teams from response', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ teams: [{ id: '1', name: 'Eng' }] });

      const teams = await validateLinearApiKey(TOKEN, 'lin_api_key');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/linear/connection/validate');
      expect(call?.[3]).toEqual({ method: 'POST', body: { apiKey: 'lin_api_key' } });
      expect(teams).toEqual([{ id: '1', name: 'Eng' }]);
    });
  });

  describe('saveLinearConnection', () => {
    it('POSTs full request body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const conn = { connected: true, teamId: 't1', teamName: 'Team' };
      vi.mocked(apiRequest).mockResolvedValue(conn);

      const req = { apiKey: 'sk', teamId: 't1', teamName: 'Team' };
      const result = await saveLinearConnection(TOKEN, req);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/linear/connection');
      expect(call?.[3]).toEqual({ method: 'POST', body: req });
      expect(result).toBe(conn);
    });
  });

  describe('disconnectLinear', () => {
    it('DELETEs /linear/connection', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ connected: false });

      await disconnectLinear(TOKEN);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/linear/connection');
      expect(call?.[3]).toEqual({ method: 'DELETE' });
    });
  });

  describe('listLinearIssues', () => {
    it('appends includeArchive query when true (default)', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ groups: [] });

      await listLinearIssues(TOKEN);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/linear/issues?includeArchive=true');
    });

    it('omits query when includeArchive=false', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ groups: [] });

      await listLinearIssues(TOKEN, false);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/linear/issues');
    });
  });

  describe('listFailedLinearIssues', () => {
    it('unwraps failedIssues from response', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ failedIssues: [{ id: 'f1' }] });

      const result = await listFailedLinearIssues(TOKEN);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/linear/failed-issues');
      expect(result).toEqual([{ id: 'f1' }]);
    });
  });

  describe('deleteFailedIssue / retryFailedIssue', () => {
    it('DELETE then POST to retry', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({});

      await deleteFailedIssue(TOKEN, 'f1');
      let call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/linear/failed-issues/f1');
      expect(call?.[3]).toEqual({ method: 'DELETE' });

      vi.mocked(apiRequest).mockResolvedValue({ issue: { id: 'i', identifier: 'INT-1', url: 'u' } });
      await retryFailedIssue(TOKEN, 'f1');
      call = vi.mocked(apiRequest).mock.calls[1];
      expect(call?.[1]).toBe('/linear/failed-issues/f1/retry');
      expect(call?.[3]).toEqual({ method: 'POST' });
    });
  });

  describe('validateLinearIssue', () => {
    it('encodes identifier and userId', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ id: 'i', identifier: 'INT-1', title: 't', url: 'u' });

      await validateLinearIssue(TOKEN, 'INT-1', 'auth0|abc');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/internal/linear/issues/INT-1?userId=auth0%7Cabc');
    });
  });

  describe('generateLinearIssueTitle', () => {
    it('POSTs description+userId', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ title: 'Title', issueType: 'feature' });

      await generateLinearIssueTitle(TOKEN, 'desc', 'user-1');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/internal/linear/issues/generate-title');
      expect(call?.[3]).toEqual({ method: 'POST', body: { description: 'desc', userId: 'user-1' } });
    });
  });

  describe('syncFromLinear', () => {
    it('POSTs /linear/sync', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({
        created: 1, updated: 0, deleted: 0, total: 1, durationMs: 10, syncedAt: '2026-04-26',
      });

      await syncFromLinear(TOKEN);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/linear/sync');
      expect(call?.[3]).toEqual({ method: 'POST' });
    });
  });

  describe('webhook config', () => {
    it('GET, POST, DELETE for webhook config', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ url: 'u', secretConfigured: true });
      await getWebhookConfig(TOKEN);
      expect(vi.mocked(apiRequest).mock.calls[0]?.[1]).toBe('/linear/webhook-config');

      vi.mocked(apiRequest).mockResolvedValue({ configured: true });
      await saveWebhookSecret(TOKEN, 'secret');
      const post = vi.mocked(apiRequest).mock.calls[1];
      expect(post?.[1]).toBe('/linear/webhook-config');
      expect(post?.[3]).toEqual({ method: 'POST', body: { secret: 'secret' } });

      vi.mocked(apiRequest).mockResolvedValue({ configured: false });
      await removeWebhookSecret(TOKEN);
      const del = vi.mocked(apiRequest).mock.calls[2];
      expect(del?.[1]).toBe('/linear/webhook-config');
      expect(del?.[3]).toEqual({ method: 'DELETE' });
    });
  });

  describe('prune candidates', () => {
    it('list unwraps candidates and delete posts DELETE', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ candidates: [{ id: 'p1' }] });

      const list = await listPruneCandidates(TOKEN);
      expect(vi.mocked(apiRequest).mock.calls[0]?.[1]).toBe('/linear/prune-candidates');
      expect(list).toEqual([{ id: 'p1' }]);

      vi.mocked(apiRequest).mockResolvedValue({ deleted: 1, failedDeletions: [], durationMs: 5 });
      await deletePruneCandidates(TOKEN);
      const call = vi.mocked(apiRequest).mock.calls[1];
      expect(call?.[1]).toBe('/linear/prune-candidates');
      expect(call?.[3]).toEqual({ method: 'DELETE' });
    });
  });

  describe('error path', () => {
    it('propagates ApiError from apiRequest', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new ApiError('VALIDATION', 'invalid', 400));

      await expect(saveLinearConnection(TOKEN, { apiKey: 'x', teamId: 't', teamName: 'T' }))
        .rejects.toThrow(ApiError);
    });
  });
});
