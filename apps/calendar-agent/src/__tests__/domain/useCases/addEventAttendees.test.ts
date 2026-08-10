import { err, ok } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addEventAttendees,
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

describe('addEventAttendees', () => {
  let userServiceClient: FakeUserServiceClient;
  let getEvent: ReturnType<typeof vi.fn<GoogleCalendarClient['getEvent']>>;
  let updateEvent: ReturnType<typeof vi.fn<GoogleCalendarClient['updateEvent']>>;
  let googleCalendarClient: GoogleCalendarClient;

  const existingEvent: CalendarEvent = {
    id: 'event-bagrowa',
    etag: '"event-bagrowa-v1"',
    summary: 'Bagrowa',
    start: { dateTime: '2026-06-25T18:00:00+02:00' },
    end: { dateTime: '2026-06-25T20:30:00+02:00' },
    attendees: [
      {
        email: 'Existing@Example.com',
        id: 'existing-profile-id',
        displayName: 'Existing guest',
        comment: 'Needs captions',
        additionalGuests: 1,
        self: false,
        organizer: false,
        resource: false,
        responseStatus: 'accepted',
        optional: true,
      },
      {
        displayName: 'Resource without email',
        responseStatus: 'tentative',
      },
    ],
  };

  const snapshot = {
    calendarId: 'team@example.com',
    expectedEtag: '"event-bagrowa-v1"',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    userServiceClient = new FakeUserServiceClient();
    userServiceClient.setTokenSuccess('google-token', 'owner@example.com');
    getEvent = vi.fn<GoogleCalendarClient['getEvent']>().mockResolvedValue(ok(existingEvent));
    updateEvent = vi
      .fn<GoogleCalendarClient['updateEvent']>()
      .mockImplementation(async (_token, _calendarId, _eventId, input) => {
        const updatedEvent: CalendarEvent = { ...existingEvent };
        if (input.attendees !== undefined) {
          updatedEvent.attendees = input.attendees;
        }
        return ok(updatedEvent);
      });
    googleCalendarClient = {
      getEvent,
      updateEvent,
    } as unknown as GoogleCalendarClient;
  });

  it('re-reads the expected event version and preserves all current attendee metadata', async () => {
    const result = await addEventAttendees(
      {
        userId: 'user-1',
        eventId: 'event-bagrowa',
        ...snapshot,
        attendeesToAdd: [
          { email: 'existing@example.COM' },
          { email: 'new@example.com' },
          { email: 'NEW@EXAMPLE.COM' },
        ],
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result.ok).toBe(true);
    expect(getEvent).toHaveBeenCalledWith(
      'google-token',
      'team@example.com',
      'event-bagrowa',
      logger
    );
    expect(updateEvent).toHaveBeenCalledWith(
      'google-token',
      'team@example.com',
      'event-bagrowa',
      {
        attendees: [
          {
            email: 'Existing@Example.com',
            id: 'existing-profile-id',
            displayName: 'Existing guest',
            comment: 'Needs captions',
            additionalGuests: 1,
            self: false,
            organizer: false,
            resource: false,
            responseStatus: 'accepted',
            optional: true,
          },
          {
            displayName: 'Resource without email',
            responseStatus: 'tentative',
          },
          { email: 'new@example.com' },
        ],
      },
      logger,
      { sendUpdates: 'all', expectedEtag: '"event-bagrowa-v1"' }
    );
  });

  it('adds attendees when the current event has no attendee list', async () => {
    const eventWithoutAttendees = { ...existingEvent };
    delete eventWithoutAttendees.attendees;
    getEvent.mockResolvedValue(ok(eventWithoutAttendees));
    await addEventAttendees(
      {
        userId: 'user-1',
        eventId: 'event-bagrowa',
        ...snapshot,
        calendarId: 'primary',
        attendeesToAdd: [{ email: 'new@example.com' }],
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(getEvent).toHaveBeenCalledWith('google-token', 'primary', 'event-bagrowa', logger);
    expect(updateEvent).toHaveBeenCalledWith(
      'google-token',
      'primary',
      'event-bagrowa',
      { attendees: [{ email: 'new@example.com' }] },
      logger,
      { sendUpdates: 'all', expectedEtag: '"event-bagrowa-v1"' }
    );
  });

  it('is idempotent when every requested attendee is already present', async () => {
    const result = await addEventAttendees(
      {
        userId: 'user-1',
        eventId: 'event-bagrowa',
        ...snapshot,
        attendeesToAdd: [
          { email: 'existing@example.com' },
          { email: 'EXISTING@EXAMPLE.COM' },
        ],
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(ok(existingEvent));
    expect(getEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('returns an OAuth error without reading or updating the event', async () => {
    userServiceClient.setTokenError('TOKEN_REFRESH_FAILED', 'expired');

    const result = await addEventAttendees(
      {
        userId: 'user-1',
        eventId: 'event-bagrowa',
        ...snapshot,
        attendeesToAdd: [{ email: 'new@example.com' }],
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(err({ code: 'TOKEN_ERROR', message: 'Failed to refresh token' }));
    expect(getEvent).not.toHaveBeenCalled();
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])('fails closed when the confirmed snapshot has no version tag', async (expectedEtag) => {
    const result = await addEventAttendees(
      {
        userId: 'user-1',
        eventId: 'event-bagrowa',
        ...snapshot,
        expectedEtag: expectedEtag as string,
        attendeesToAdd: [{ email: 'new@example.com' }],
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(
      err({ code: 'INTERNAL_ERROR', message: 'Calendar event version unavailable' })
    );
    expect(getEvent).not.toHaveBeenCalled();
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('returns a conflict without patching when the event changed after confirmation', async () => {
    getEvent.mockResolvedValue(ok({ ...existingEvent, etag: '"event-bagrowa-v2"' }));

    const result = await addEventAttendees(
      {
        userId: 'user-1',
        eventId: 'event-bagrowa',
        ...snapshot,
        attendeesToAdd: [{ email: 'new@example.com' }],
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

  it('fails closed without patching when Google omits part of the attendee list', async () => {
    getEvent.mockResolvedValue(ok({ ...existingEvent, attendeesOmitted: true }));

    const result = await addEventAttendees(
      {
        userId: 'user-1',
        eventId: 'event-bagrowa',
        ...snapshot,
        attendeesToAdd: [{ email: 'new@example.com' }],
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(
      err({ code: 'INTERNAL_ERROR', message: 'Calendar attendee list is incomplete' })
    );
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('returns the update error', async () => {
    updateEvent.mockResolvedValue(err({ code: 'PERMISSION_DENIED', message: 'Forbidden' }));

    const result = await addEventAttendees(
      {
        userId: 'user-1',
        eventId: 'event-bagrowa',
        ...snapshot,
        attendeesToAdd: [{ email: 'new@example.com' }],
      },
      { userServiceClient, googleCalendarClient, logger }
    );

    expect(result).toEqual(err({ code: 'PERMISSION_DENIED', message: 'Forbidden' }));
  });
});
