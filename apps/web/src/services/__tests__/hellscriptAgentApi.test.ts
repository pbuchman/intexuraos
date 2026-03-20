/**
 * Tests for hellscriptAgentApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listHellscriptBuffers,
  getHellscriptWorkspace,
  imposeOnBuffer,
} from '../hellscriptAgentApi.js';
import type {
  HellscriptBufferSummary,
  HellscriptWorkspaceResponse,
  HellscriptImposeResponse,
} from '../../types/index.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    hellscriptAgentUrl: 'https://hellscript-agent.test',
  },
}));

describe('hellscriptAgentApi', () => {
  const mockAccessToken = 'test-access-token';

  const mockBuffer: HellscriptBufferSummary = {
    id: 'buf-123',
    userId: 'user-456',
    title: 'My Thoughts',
    eventCount: 3,
    latestDraftVersionNumber: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listHellscriptBuffers', () => {
    it('fetches buffers and returns the array directly', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue([mockBuffer]);

      const result = await listHellscriptBuffers(mockAccessToken);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://hellscript-agent.test',
        '/hellscript/buffers',
        mockAccessToken
      );
      expect(result).toEqual([mockBuffer]);
    });

    it('returns empty array when no buffers exist', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue([]);

      const result = await listHellscriptBuffers(mockAccessToken);

      expect(result).toEqual([]);
    });
  });

  describe('getHellscriptWorkspace', () => {
    it('fetches workspace by buffer id', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockWorkspace: HellscriptWorkspaceResponse = {
        buffer: mockBuffer,
        events: [],
        draftVersions: [],
      };
      vi.mocked(apiRequest).mockResolvedValue(mockWorkspace);

      const result = await getHellscriptWorkspace(mockAccessToken, 'buf-123');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://hellscript-agent.test',
        '/hellscript/buffers/buf-123',
        mockAccessToken
      );
      expect(result).toEqual(mockWorkspace);
    });
  });

  describe('imposeOnBuffer', () => {
    it('sends impose request with bufferId', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: HellscriptImposeResponse = {
        bufferId: 'buf-123',
        action: 'append_thought',
      };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await imposeOnBuffer(mockAccessToken, {
        bufferId: 'buf-123',
        utterance: 'A new thought',
      });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://hellscript-agent.test',
        '/hellscript/impose',
        mockAccessToken,
        {
          method: 'POST',
          body: { bufferId: 'buf-123', utterance: 'A new thought' },
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('sends impose request without bufferId for new buffer', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: HellscriptImposeResponse = {
        bufferId: 'buf-new',
        action: 'append_thought',
        latestDraftVersionId: 'draft-1',
      };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await imposeOnBuffer(mockAccessToken, {
        utterance: 'First thought',
      });

      expect(apiRequest).toHaveBeenCalledWith(
        'https://hellscript-agent.test',
        '/hellscript/impose',
        mockAccessToken,
        {
          method: 'POST',
          body: { utterance: 'First thought' },
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });
});
