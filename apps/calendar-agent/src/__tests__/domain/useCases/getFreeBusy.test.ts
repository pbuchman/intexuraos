import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { getFreeBusy } from '../../../domain/useCases/getFreeBusy.js';
import { FakeGoogleCalendarClient, FakeUserServiceClient } from '../../fakes.js';
import type { Logger } from '@intexuraos/common-core';
import type { FreeBusySlot } from '../../../domain/models.js';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('getFreeBusy', () => {
  let userServiceClient: FakeUserServiceClient;
  let googleCalendarClient: FakeGoogleCalendarClient;

  beforeEach(() => {
    userServiceClient = new FakeUserServiceClient();
    googleCalendarClient = new FakeGoogleCalendarClient();
    vi.clearAllMocks();
  });

  describe('successful free/busy retrieval', () => {
    it('returns free/busy slots for primary calendar', async () => {
      const slots: FreeBusySlot[] = [
        { start: '2025-01-15T10:00:00Z', end: '2025-01-15T11:00:00Z' },
      ];
      googleCalendarClient.setFreeBusyResult(ok(new Map([['primary', slots]])));

      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(1);
        expect(result.value.get('primary')).toEqual(slots);
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          timeMin: '2025-01-15T00:00:00Z',
          timeMax: '2025-01-16T00:00:00Z',
          calendarCount: 1,
        },
        'getFreeBusy: entry'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          calendarCount: 1,
        },
        'getFreeBusy: success'
      );
    });

    it('returns free/busy slots for multiple calendars', async () => {
      const workSlots: FreeBusySlot[] = [
        { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z' },
      ];
      const personalSlots: FreeBusySlot[] = [];
      googleCalendarClient.setFreeBusyResult(
        ok(
          new Map([
            ['work', workSlots],
            ['personal', personalSlots],
          ])
        )
      );

      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
            items: [{ id: 'work' }, { id: 'personal' }],
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(2);
        expect(result.value.get('work')).toEqual(workSlots);
        expect(result.value.get('personal')).toEqual(personalSlots);
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          timeMin: '2025-01-15T00:00:00Z',
          timeMax: '2025-01-16T00:00:00Z',
          calendarCount: 2,
        },
        'getFreeBusy: entry'
      );
    });

    it('works without logger', async () => {
      const slots: FreeBusySlot[] = [
        { start: '2025-01-15T10:00:00Z', end: '2025-01-15T11:00:00Z' },
      ];
      googleCalendarClient.setFreeBusyResult(ok(new Map([['primary', slots]])));

      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('OAuth token errors', () => {
    it('returns error when user is not connected', async () => {
      userServiceClient.setTokenError('CONNECTION_NOT_FOUND', 'Google Calendar not connected');

      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('Google Calendar not connected');
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          error: { code: 'CONNECTION_NOT_FOUND', message: 'Google Calendar not connected' },
        },
        'getFreeBusy: failed to get OAuth token'
      );
    });

    it('returns error when token fetch fails', async () => {
      userServiceClient.setTokenError('TOKEN_REFRESH_FAILED', 'Invalid token');

      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_ERROR');
      }
    });
  });

  describe('Google Calendar API errors', () => {
    it('returns error when Google Calendar API fails', async () => {
      googleCalendarClient.setFreeBusyResult(
        err({ code: 'INTERNAL_ERROR', message: 'Google Calendar API unavailable' })
      );

      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Google Calendar API unavailable');
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          error: { code: 'INTERNAL_ERROR', message: 'Google Calendar API unavailable' },
        },
        'getFreeBusy: failed to get free/busy'
      );
    });

    it('returns error for rate limiting', async () => {
      googleCalendarClient.setFreeBusyResult(
        err({ code: 'QUOTA_EXCEEDED', message: 'Too many requests' })
      );

      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('QUOTA_EXCEEDED');
      }
    });
  });

  describe('edge cases', () => {
    it('handles empty items array', async () => {
      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
            items: [],
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
    });

    it('handles missing items (undefined)', async () => {
      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          timeMin: '2025-01-15T00:00:00Z',
          timeMax: '2025-01-16T00:00:00Z',
          calendarCount: 1,
        },
        'getFreeBusy: entry'
      );
    });

    it('handles empty free/busy response', async () => {
      googleCalendarClient.setFreeBusyResult(ok(new Map()));

      const result = await getFreeBusy(
        {
          userId: 'user-123',
          input: {
            timeMin: '2025-01-15T00:00:00Z',
            timeMax: '2025-01-16T00:00:00Z',
          },
        },
        {
          userServiceClient,
          googleCalendarClient,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(0);
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          calendarCount: 0,
        },
        'getFreeBusy: success'
      );
    });
  });
});
