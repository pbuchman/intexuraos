import { err, ok } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  updateExistingEvent,
  type CalendarEvent,
  type GoogleCalendarClient,
} from '../../../domain/index.js';
import { FakeUserServiceClient } from '../../fakes.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

describe('updateExistingEvent', () => {
  let userServiceClient: FakeUserServiceClient;
  let getEvent: ReturnType<typeof vi.fn<GoogleCalendarClient['getEvent']>>;
  let updateEvent: ReturnType<typeof vi.fn<GoogleCalendarClient['updateEvent']>>;
  let googleCalendarClient: GoogleCalendarClient;

  const existingEvent: CalendarEvent = {
    id: 'event-1',
    etag: '"event-1-v1"',
    summary: 'Google Photos od 04.2019',
    description: 'Cleanup',
    location: 'Home',
    start: { date: '2026-08-13' },
    end: { date: '2026-08-14' },
    attendees: [
      { email: 'keep@example.com', displayName: 'Keep', responseStatus: 'accepted' },
      { email: 'remove@example.com', optional: true },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    userServiceClient = new FakeUserServiceClient();
    userServiceClient.setTokenSuccess('google-token', 'owner@example.com');
    getEvent = vi.fn<GoogleCalendarClient['getEvent']>().mockResolvedValue(ok(existingEvent));
    updateEvent = vi.fn<GoogleCalendarClient['updateEvent']>().mockResolvedValue(ok(existingEvent));
    googleCalendarClient = { getEvent, updateEvent } as unknown as GoogleCalendarClient;
  });

  it('patches every supported mutable field and preserves retained attendee metadata', async () => {
    const result = await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: {
          summary: 'Google Photos archive',
          description: null,
          location: 'Office',
          start: { date: '2026-08-22' },
          end: { date: '2026-08-23' },
          attendeesToAdd: [{ email: 'new@example.com' }],
          attendeesToRemove: [{ email: 'REMOVE@example.com' }],
        },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result.ok).toBe(true);
    expect(getEvent).toHaveBeenCalledWith('google-token', 'primary', 'event-1', logger);
    expect(updateEvent).toHaveBeenCalledWith(
      'google-token',
      'primary',
      'event-1',
      {
        summary: 'Google Photos archive',
        description: '',
        location: 'Office',
        start: { date: '2026-08-22' },
        end: { date: '2026-08-23' },
        attendees: [
          { email: 'keep@example.com', displayName: 'Keep', responseStatus: 'accepted' },
          { email: 'new@example.com' },
        ],
      },
      logger,
      { sendUpdates: 'all', expectedEtag: '"event-1-v1"' }
    );
  });

  it('patches ordinary fields without touching attendees', async () => {
    await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: { summary: 'Renamed' },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(updateEvent).toHaveBeenCalledWith(
      'google-token',
      'primary',
      'event-1',
      { summary: 'Renamed' },
      logger,
      { expectedEtag: '"event-1-v1"' }
    );
  });

  it('fails before patching when the confirmed event version is stale', async () => {
    getEvent.mockResolvedValue(ok({ ...existingEvent, etag: '"event-1-v2"' }));

    const result = await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: { summary: 'Renamed' },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(
      err({
        code: 'CONFLICT',
        message: 'Calendar event changed after confirmation; repeat the request',
      })
    );
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('fails closed when attendee data is incomplete', async () => {
    getEvent.mockResolvedValue(ok({ ...existingEvent, attendeesOmitted: true }));

    const result = await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: { attendeesToAdd: [{ email: 'new@example.com' }] },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(
      err({ code: 'INTERNAL_ERROR', message: 'Calendar attendee list is incomplete' })
    );
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])('fails closed when the event version is unavailable', async (etag) => {
    const result = await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: etag as string,
        changes: { summary: 'Renamed' },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(
      err({ code: 'INTERNAL_ERROR', message: 'Calendar event version unavailable' })
    );
    expect(getEvent).not.toHaveBeenCalled();
  });

  it('returns an OAuth error before reading the event', async () => {
    userServiceClient.setTokenError('TOKEN_REFRESH_FAILED', 'expired');

    const result = await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: { summary: 'Renamed' },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(err({ code: 'TOKEN_ERROR', message: 'Failed to refresh token' }));
    expect(getEvent).not.toHaveBeenCalled();
  });

  it('returns the current-event lookup error', async () => {
    getEvent.mockResolvedValue(err({ code: 'NOT_FOUND', message: 'Missing' }));

    const result = await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: { summary: 'Renamed' },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(err({ code: 'NOT_FOUND', message: 'Missing' }));
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('adds attendees to an event without an attendee list', async () => {
    const eventWithoutAttendees = { ...existingEvent };
    delete eventWithoutAttendees.attendees;
    getEvent.mockResolvedValue(ok(eventWithoutAttendees));

    await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: { attendeesToAdd: [{ email: 'new@example.com' }] },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(updateEvent).toHaveBeenCalledWith(
      'google-token',
      'primary',
      'event-1',
      { attendees: [{ email: 'new@example.com' }] },
      logger,
      { sendUpdates: 'all', expectedEtag: '"event-1-v1"' }
    );
  });

  it('removes attendees case-insensitively while retaining entries without email addresses', async () => {
    getEvent.mockResolvedValue(
      ok({
        ...existingEvent,
        attendees: [
          { displayName: 'Room resource', resource: true },
          { email: 'REMOVE@example.com', optional: true },
        ],
      })
    );

    await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: { attendeesToRemove: [{ email: 'remove@example.com' }] },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(updateEvent).toHaveBeenCalledWith(
      'google-token',
      'primary',
      'event-1',
      { attendees: [{ displayName: 'Room resource', resource: true }] },
      logger,
      { sendUpdates: 'all', expectedEtag: '"event-1-v1"' }
    );
  });

  it('does not patch when the only requested attendee additions already exist', async () => {
    const result = await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: {
          attendeesToAdd: [
            { email: 'KEEP@example.com' },
            { email: 'keep@example.com' },
          ],
        },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(ok(existingEvent));
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('allows ordinary updates when Google marks only attendee data as incomplete', async () => {
    getEvent.mockResolvedValue(ok({ ...existingEvent, attendeesOmitted: true }));

    await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: { location: null },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(updateEvent).toHaveBeenCalledWith(
      'google-token',
      'primary',
      'event-1',
      { location: '' },
      logger,
      { expectedEtag: '"event-1-v1"' }
    );
  });

  it('returns an update error after validating the snapshot', async () => {
    updateEvent.mockResolvedValue(err({ code: 'PERMISSION_DENIED', message: 'Forbidden' }));

    const result = await updateExistingEvent(
      {
        userId: 'user-1',
        calendarId: 'primary',
        eventId: 'event-1',
        expectedEtag: '"event-1-v1"',
        changes: { summary: 'Renamed' },
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(err({ code: 'PERMISSION_DENIED', message: 'Forbidden' }));
  });
});
