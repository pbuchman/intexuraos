/**
 * Tests for whatsappPreferencesApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getWhatsAppPreferences,
  updateWhatsAppPreferences,
  type WhatsAppPreferences,
} from '../whatsappPreferencesApi.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    whatsappServiceUrl: 'https://wa.test',
  },
}));

const TOKEN = 'tok';

describe('whatsappPreferencesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWhatsAppPreferences', () => {
    it('GETs /whatsapp/preferences with token and returns data', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const resp: WhatsAppPreferences = { notificationLevel: 'all' };
      vi.mocked(apiRequest).mockResolvedValue(resp);

      const result = await getWhatsAppPreferences(TOKEN);

      expect(apiRequest).toHaveBeenCalledTimes(1);
      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[0]).toBe('https://wa.test');
      expect(call?.[1]).toBe('/whatsapp/preferences');
      expect(call?.[2]).toBe(TOKEN);
      expect(call?.[3]).toBeUndefined();
      expect(result).toBe(resp);
    });

    it('returns important level when server reports it', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const resp: WhatsAppPreferences = { notificationLevel: 'important' };
      vi.mocked(apiRequest).mockResolvedValue(resp);

      const result = await getWhatsAppPreferences(TOKEN);

      expect(result.notificationLevel).toBe('important');
    });
  });

  describe('updateWhatsAppPreferences', () => {
    it('PUTs the body to /whatsapp/preferences and returns server-confirmed level', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const confirmed: WhatsAppPreferences = { notificationLevel: 'important' };
      vi.mocked(apiRequest).mockResolvedValue(confirmed);

      const result = await updateWhatsAppPreferences(TOKEN, {
        notificationLevel: 'important',
      });

      expect(apiRequest).toHaveBeenCalledTimes(1);
      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[0]).toBe('https://wa.test');
      expect(call?.[1]).toBe('/whatsapp/preferences');
      expect(call?.[2]).toBe(TOKEN);
      expect(call?.[3]).toEqual({
        method: 'PUT',
        body: { notificationLevel: 'important' },
      });
      expect(result).toBe(confirmed);
    });

    it('sends all level as body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const confirmed: WhatsAppPreferences = { notificationLevel: 'all' };
      vi.mocked(apiRequest).mockResolvedValue(confirmed);

      await updateWhatsAppPreferences(TOKEN, { notificationLevel: 'all' });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[3]).toEqual({
        method: 'PUT',
        body: { notificationLevel: 'all' },
      });
    });
  });
});
