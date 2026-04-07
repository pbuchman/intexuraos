/**
 * Tests for userTimezoneApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { patchUserTimezone } from '../userTimezoneApi.js';
import type { PatchTimezoneResponse } from '../userTimezoneApi.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    authServiceUrl: 'https://user-service.test',
  },
}));

describe('userTimezoneApi', () => {
  const mockAccessToken = 'test-access-token';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('patchUserTimezone', () => {
    it('sends PATCH with correct URL, method, and body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: PatchTimezoneResponse = { timezone: 'America/New_York' };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await patchUserTimezone(mockAccessToken, 'user-123', 'America/New_York');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://user-service.test',
        '/users/user-123/settings/timezone',
        mockAccessToken,
        { method: 'PATCH', body: { timezone: 'America/New_York' } }
      );
      expect(result).toEqual(mockResponse);
    });

    it('encodes special characters in userId', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ timezone: 'Europe/Berlin' });

      await patchUserTimezone(mockAccessToken, 'auth0|abc123', 'Europe/Berlin');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://user-service.test',
        '/users/auth0%7Cabc123/settings/timezone',
        mockAccessToken,
        { method: 'PATCH', body: { timezone: 'Europe/Berlin' } }
      );
    });

    it('propagates errors from apiRequest', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new Error('Validation failed'));

      await expect(
        patchUserTimezone(mockAccessToken, 'user-123', 'Invalid/Zone')
      ).rejects.toThrow('Validation failed');
    });
  });
});
