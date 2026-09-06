import { err, ok, type Result, type ServiceFeedback } from '@intexuraos/common-core';
import type {
  CreateBookmarkError,
  CreateBookmarkResponse,
  CreatedCalendarEvent,
  ListCalendarEventsRequest,
  SubmitTaskError,
  SubmitTaskResponse,
} from '@intexuraos/internal-clients';
import { describe, expect, it } from 'vitest';
import { createIntexAgentToolExecutor } from '../../domain/agent/toolExecutor.js';
import type { PromptPreferencesRepository } from '../../domain/ports/promptPreferencesRepository.js';
import {
  addPromptPreferenceItem,
  deletePromptPreferenceItem,
  assertExpectedPromptPreferenceVersion,
  emptyPromptPreferences,
  updatePromptPreferenceItem,
  type IntexAgentPromptPreferenceVersion,
  type IntexAgentPromptPreferences,
} from '../../domain/preferences/promptPreferences.js';
import type {
  BookmarksToolClient,
  CalendarToolClient,
  CodeTaskToolClient,
  CreateIntexAgentToolExecutorDeps,
  ExternalSaveToolClient,
  NotesToolClient,
  ResearchToolClient,
} from '../../domain/agent/toolExecutor.js';

interface CalendarQueryEvent {
  id: string;
  etag?: string | undefined;
  summary: string;
  start: {
    dateTime?: string | undefined;
    date?: string | undefined;
    timeZone?: string | undefined;
  };
  end: {
    dateTime?: string | undefined;
    date?: string | undefined;
    timeZone?: string | undefined;
  };
  location?: string | undefined;
  htmlLink?: string | undefined;
}

describe('createIntexAgentToolExecutor', () => {
  it('creates notes through the notes client with WhatsApp source metadata', async () => {
    const notesClient = new FakeNotesClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      notesClient,
    }));

    const result = await executor.createNote({
      title: 'Door code',
      content: 'The studio door code is 4281.',
      tags: ['studio'],
      sourceMessageIds: ['wamid-override'],
    });

    expect(notesClient.calls).toEqual([
      {
        userId: 'user-1',
        title: 'Door code',
        content: 'The studio door code is 4281.',
        tags: ['studio'],
        source: 'whatsapp',
        sourceId: 'wamid-override',
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      message: 'Note saved',
      resourceUrl: '/notes/note-1',
    });
  });

  it('uses a generated note title and the current WhatsApp message id by default', async () => {
    const notesClient = new FakeNotesClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      notesClient,
    }));

    await executor.createNote({
      content: 'Remember that the backup keys are in the blue drawer near the entrance.',
    });

    expect(notesClient.calls[0]).toMatchObject({
      title: 'Remember that the backup keys are in the blue drawer near the entrance.',
      tags: [],
      sourceId: 'wamid-1',
    });
  });

  it('uses a fallback title for empty note content and omits absent resource URLs', async () => {
    const notesClient = new FakeNotesClient();
    notesClient.result = ok({
      status: 'completed',
      message: 'Note saved',
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      notesClient,
    }));

    const result = await executor.createNote({ content: '   ' });

    expect(notesClient.calls[0]).toMatchObject({
      title: 'WhatsApp note',
      tags: [],
      sourceId: 'wamid-1',
    });
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      message: 'Note saved',
    });
  });

  it('truncates generated note titles for long content', async () => {
    const notesClient = new FakeNotesClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      notesClient,
    }));

    await executor.createNote({
      content: 'A'.repeat(90),
    });

    expect(notesClient.calls[0]?.title).toBe(`${'A'.repeat(77)}...`);
  });

  it('throws when notes-agent returns failed service feedback', async () => {
    const notesClient = new FakeNotesClient();
    notesClient.result = ok({
      status: 'failed',
      message: 'Notion token missing',
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      notesClient,
    }));

    await expect(executor.createNote({ content: 'remember this' })).rejects.toThrow(
      'Failed to create note: Notion token missing'
    );
  });

  it('creates calendar events through the calendar client', async () => {
    const calendarClient = new FakeCalendarClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      calendarClient,
    }));

    const result = await executor.createCalendarEvent({
      summary: 'Dentist appointment',
      start: '2026-06-25T09:00:00.000Z',
      end: '2026-06-25T10:00:00.000Z',
      timeZone: 'Europe/Warsaw',
      location: 'Dental clinic',
      description: 'Annual checkup',
      attendees: ['assistant@example.com'],
    });

    expect(calendarClient.calls).toEqual([
      {
        userId: 'user-1',
        event: {
          summary: 'Dentist appointment',
          start: {
            dateTime: '2026-06-25T09:00:00.000Z',
            timeZone: 'Europe/Warsaw',
          },
          end: {
            dateTime: '2026-06-25T10:00:00.000Z',
            timeZone: 'Europe/Warsaw',
          },
          location: 'Dental clinic',
          description: 'Annual checkup',
          attendees: [{ email: 'assistant@example.com' }],
        },
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      eventId: 'calendar-event-1',
      summary: 'Dentist appointment',
      htmlLink: 'https://calendar.google.com/event?eid=calendar-event-1',
    });
  });

  it('creates minimal calendar events without optional metadata', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.result = ok({
      id: 'calendar-event-2',
      summary: 'Dentist appointment',
      start: {
        dateTime: '2026-06-25T09:00:00.000Z',
      },
      end: {
        dateTime: '2026-06-25T10:00:00.000Z',
      },
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      calendarClient,
    }));

    const result = await executor.createCalendarEvent({
      summary: 'Dentist appointment',
      start: '2026-06-25T09:00:00.000Z',
      end: '2026-06-25T10:00:00.000Z',
    });

    expect(calendarClient.calls).toEqual([
      {
        userId: 'user-1',
        event: {
          summary: 'Dentist appointment',
          start: { dateTime: '2026-06-25T09:00:00.000Z' },
          end: { dateTime: '2026-06-25T10:00:00.000Z' },
        },
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      eventId: 'calendar-event-2',
      summary: 'Dentist appointment',
    });
  });

  it('throws when calendar-agent returns a failure', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.result = err(new Error('calendar-agent unavailable'));
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      calendarClient,
    }));

    await expect(
      executor.createCalendarEvent({
        summary: 'Dentist appointment',
        start: '2026-06-25T09:00:00.000Z',
        end: '2026-06-25T10:00:00.000Z',
      })
    ).rejects.toThrow('Failed to create calendar event: calendar-agent unavailable');
  });

  it('adds attendees to an existing calendar event through the calendar client', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.updateResult = ok({
      id: 'event-bagrowa',
      summary: 'Bagrowa',
      start: { dateTime: '2026-06-25T18:00:00+02:00' },
      end: { dateTime: '2026-06-25T20:30:00+02:00' },
      attendees: [{ email: 'patryk@example.com', responseStatus: 'needsAction' }],
      htmlLink: 'https://calendar.google.com/event?eid=event-bagrowa',
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));

    const result = await executor.updateCalendarEvent({
      eventId: 'event-bagrowa',
      eventSummary: 'Bagrowa',
      attendeesToAdd: ['patryk@example.com'],
      calendarId: 'primary',
      expectedEtag: '"event-bagrowa-v1"',
      eventStart: { dateTime: '2026-06-25T18:00:00+02:00' },
      eventEnd: { dateTime: '2026-06-25T20:30:00+02:00' },
    });

    expect(calendarClient.updateCalls).toEqual([
      {
        userId: 'user-1',
        eventId: 'event-bagrowa',
        calendarId: 'primary',
        expectedEtag: '"event-bagrowa-v1"',
        changes: { attendeesToAdd: [{ email: 'patryk@example.com' }] },
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      eventId: 'event-bagrowa',
      summary: 'Bagrowa',
      attendeesAdded: ['patryk@example.com'],
      htmlLink: 'https://calendar.google.com/event?eid=event-bagrowa',
    });
  });

  it('throws when an existing calendar event attendee update fails', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.updateResult = err(new Error('calendar update unavailable'));
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));

    await expect(
      executor.updateCalendarEvent({
        eventId: 'event-bagrowa',
        eventSummary: 'Bagrowa',
        attendeesToAdd: ['patryk@example.com'],
        calendarId: 'primary',
        expectedEtag: '"event-bagrowa-v1"',
        eventStart: { dateTime: '2026-06-25T18:00:00+02:00' },
        eventEnd: { dateTime: '2026-06-25T20:30:00+02:00' },
      })
    ).rejects.toThrow('Failed to update calendar event: calendar update unavailable');
  });

  it('updates general existing calendar event fields through the calendar client', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.updateResult = ok({
      id: 'event-photos',
      summary: 'Google Photos archive',
      start: { date: '2026-08-22' },
      end: { date: '2026-08-23' },
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));

    const result = await executor.updateCalendarEvent({
      eventId: 'event-photos',
      eventSummary: 'Google Photos od 04.2019',
      calendarId: 'primary',
      expectedEtag: '"event-photos-v1"',
      eventStart: { date: '2026-08-13' },
      eventEnd: { date: '2026-08-14' },
      changes: {
        summary: 'Google Photos archive',
        start: { date: '2026-08-22' },
        end: { date: '2026-08-23' },
        location: null,
        description: 'Cleanup',
        attendeesToAdd: ['new@example.com'],
        attendeesToRemove: ['old@example.com'],
      },
    });

    expect(calendarClient.updateCalls).toEqual([
      {
        userId: 'user-1',
        eventId: 'event-photos',
        calendarId: 'primary',
        expectedEtag: '"event-photos-v1"',
        changes: {
          summary: 'Google Photos archive',
          start: { date: '2026-08-22' },
          end: { date: '2026-08-23' },
          location: null,
          description: 'Cleanup',
          attendeesToAdd: [{ email: 'new@example.com' }],
          attendeesToRemove: [{ email: 'old@example.com' }],
        },
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      eventId: 'event-photos',
      summary: 'Google Photos archive',
      attendeesAdded: ['new@example.com'],
    });
  });

  it('updates a non-attendee field without reporting attendee additions', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.updateResult = ok({
      id: 'event-photos',
      summary: 'Google Photos archive',
      start: { date: '2026-08-22' },
      end: { date: '2026-08-23' },
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));

    const result = await executor.updateCalendarEvent({
      eventId: 'event-photos',
      eventSummary: 'Google Photos od 04.2019',
      calendarId: 'primary',
      expectedEtag: '"event-photos-v1"',
      eventStart: { date: '2026-08-13' },
      eventEnd: { date: '2026-08-14' },
      changes: { summary: 'Google Photos archive' },
    });

    expect(calendarClient.updateCalls[0]?.changes).toEqual({ summary: 'Google Photos archive' });
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      eventId: 'event-photos',
      summary: 'Google Photos archive',
    });
  });

  it('rejects an update with no general or legacy changes', async () => {
    const calendarClient = new FakeCalendarClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));

    await expect(
      executor.updateCalendarEvent({
        eventId: 'event-photos',
        eventSummary: 'Google Photos od 04.2019',
        calendarId: 'primary',
        expectedEtag: '"event-photos-v1"',
        eventStart: { date: '2026-08-13' },
        eventEnd: { date: '2026-08-14' },
      })
    ).rejects.toThrow('Calendar event changes are missing');
    expect(calendarClient.updateCalls).toEqual([]);
  });

  it('omits the calendar link when an attendee update response has none', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.updateResult = ok({
      id: 'event-bagrowa',
      summary: 'Bagrowa',
      start: { dateTime: '2026-06-25T18:00:00+02:00' },
      end: { dateTime: '2026-06-25T20:30:00+02:00' },
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));

    const result = await executor.updateCalendarEvent({
      eventId: 'event-bagrowa',
      eventSummary: 'Bagrowa',
      attendeesToAdd: ['patryk@example.com'],
      calendarId: 'primary',
      expectedEtag: '"event-bagrowa-v1"',
      eventStart: { dateTime: '2026-06-25T18:00:00+02:00' },
      eventEnd: { dateTime: '2026-06-25T20:30:00+02:00' },
    });

    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      eventId: 'event-bagrowa',
      summary: 'Bagrowa',
      attendeesAdded: ['patryk@example.com'],
    });
  });

  it('rejects every incomplete calendar event snapshot before calling the client', async () => {
    const calendarClient = new FakeCalendarClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));
    const completeInput = {
      eventId: 'event-bagrowa',
      eventSummary: 'Bagrowa',
      attendeesToAdd: ['patryk@example.com'],
      calendarId: 'primary',
      expectedEtag: '"event-bagrowa-v1"',
      eventStart: { dateTime: '2026-06-25T18:00:00+02:00' },
      eventEnd: { dateTime: '2026-06-25T20:30:00+02:00' },
    };
    const { calendarId: _calendarId, ...withoutCalendarId } = completeInput;
    const { expectedEtag: _expectedEtag, ...withoutExpectedEtag } = completeInput;
    const { eventStart: _eventStart, ...withoutEventStart } = completeInput;
    const { eventEnd: _eventEnd, ...withoutEventEnd } = completeInput;

    for (const input of [
      withoutCalendarId,
      { ...completeInput, calendarId: '  ' },
      withoutExpectedEtag,
      { ...completeInput, expectedEtag: '  ' },
      withoutEventStart,
      withoutEventEnd,
    ]) {
      await expect(executor.updateCalendarEvent(input)).rejects.toThrow(
        'Calendar event snapshot is missing or incomplete'
      );
    }
    expect(calendarClient.updateCalls).toEqual([]);
  });

  it('counts calendar events through the calendar client', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = ok({
      events: [
        event('event-1', 'Dentist', '2026-05-03T09:00:00.000Z'),
        event('event-2', 'Dentist follow-up', '2026-05-20T09:00:00.000Z'),
      ],
      truncated: false,
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));
    const queryCalendarEvents = executor.queryCalendarEvents;
    if (queryCalendarEvents === undefined) {
      throw new Error('queryCalendarEvents should be configured');
    }

    const result = await queryCalendarEvents({
      mode: 'count',
      timeMin: '2026-05-01T00:00:00.000Z',
      timeMax: '2026-06-01T00:00:00.000Z',
      query: 'Dentist',
    });

    expect(calendarClient.listCalls).toEqual([
      {
        userId: 'user-1',
        timeMin: '2026-05-01T00:00:00.000Z',
        timeMax: '2026-06-01T00:00:00.000Z',
        maxResults: 2500,
        q: 'Dentist',
      },
    ]);
    expect(JSON.parse(result)).toMatchObject({
      status: 'completed',
      mode: 'count',
      count: 2,
      truncated: false,
      timeMin: '2026-05-01T00:00:00.000Z',
      timeMax: '2026-06-01T00:00:00.000Z',
      query: 'Dentist',
    });
  });

  it('trusts the calendar client pagination verdict when a count exactly hits the query cap', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = ok({
      events: [
        event('event-1', 'Dentist', '2026-05-03T09:00:00.000Z'),
        event('event-2', 'Dentist follow-up', '2026-05-20T09:00:00.000Z'),
      ],
      truncated: false,
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));
    const queryCalendarEvents = executor.queryCalendarEvents;
    if (queryCalendarEvents === undefined) {
      throw new Error('queryCalendarEvents should be configured');
    }

    const result = await queryCalendarEvents({
      mode: 'count',
      timeMin: '2026-05-01T00:00:00.000Z',
      timeMax: '2026-06-01T00:00:00.000Z',
      maxResults: 2,
    });

    expect(JSON.parse(result)).toMatchObject({
      status: 'completed',
      mode: 'count',
      count: 2,
      truncated: false,
    });
  });

  it('trusts the calendar client pagination verdict when a list exactly hits the query cap', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = ok({
      events: [event('event-1', 'Dentist', '2026-05-03T09:00:00.000Z')],
      truncated: false,
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));
    const queryCalendarEvents = executor.queryCalendarEvents;
    if (queryCalendarEvents === undefined) {
      throw new Error('queryCalendarEvents should be configured');
    }

    const result = await queryCalendarEvents({
      mode: 'list',
      timeMin: '2026-05-01T00:00:00.000Z',
      timeMax: '2026-06-01T00:00:00.000Z',
      maxResults: 1,
    });

    expect(JSON.parse(result)).toMatchObject({
      status: 'completed',
      mode: 'list',
      count: 1,
      truncated: false,
    });
  });

  it('marks a short calendar event list as truncated when the API has another page', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = ok({
      events: [event('event-1', 'Bagrowa', '2026-05-03T09:00:00.000Z')],
      truncated: true,
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));
    const queryCalendarEvents = executor.queryCalendarEvents;
    if (queryCalendarEvents === undefined) {
      throw new Error('queryCalendarEvents should be configured');
    }

    const result = await queryCalendarEvents({
      mode: 'list',
      timeMin: '2026-05-01T00:00:00.000Z',
      timeMax: '2026-06-01T00:00:00.000Z',
      maxResults: 20,
      query: 'Bagrowa',
    });

    expect(JSON.parse(result)).toMatchObject({
      status: 'completed',
      mode: 'list',
      count: 1,
      truncated: true,
    });
  });

  it('fails closed when the calendar client omits the pagination verdict', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = ok({
      events: [event('event-1', 'Bagrowa', '2026-05-03T09:00:00.000Z')],
      truncated: undefined as unknown as boolean,
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));

    await expect(
      executor.queryCalendarEvents({
        mode: 'list',
        timeMin: '2026-05-01T00:00:00.000Z',
        timeMax: '2026-06-01T00:00:00.000Z',
      })
    ).rejects.toThrow('Calendar query response has no pagination verdict');
  });

  it('lists calendar events through the calendar client with safe event fields', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = ok({
      events: [
        {
          ...event('event-1', 'Dentist', '2026-05-03T09:00:00.000Z'),
          etag: '"event-1-v1"',
          location: 'Smile Clinic',
          htmlLink: 'https://calendar.google.com/event?eid=event-1',
          description: 'Private detail',
          status: 'confirmed',
        },
        event('event-2', 'Focus time', '2026-05-04T09:00:00.000Z'),
      ],
      truncated: false,
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));
    const queryCalendarEvents = executor.queryCalendarEvents;
    if (queryCalendarEvents === undefined) {
      throw new Error('queryCalendarEvents should be configured');
    }

    const result = await queryCalendarEvents({
      mode: 'list',
      timeMin: '2026-05-01T00:00:00.000Z',
      timeMax: '2026-06-01T00:00:00.000Z',
      calendarId: 'primary',
    });

    expect(calendarClient.listCalls).toEqual([
      {
        userId: 'user-1',
        calendarId: 'primary',
        timeMin: '2026-05-01T00:00:00.000Z',
        timeMax: '2026-06-01T00:00:00.000Z',
        maxResults: 20,
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      mode: 'list',
      count: 2,
      truncated: false,
      timeMin: '2026-05-01T00:00:00.000Z',
      timeMax: '2026-06-01T00:00:00.000Z',
      events: [
        {
          id: 'event-1',
          etag: '"event-1-v1"',
          summary: 'Dentist',
          calendarId: 'primary',
          start: { dateTime: '2026-05-03T09:00:00.000Z' },
          end: { dateTime: '2026-05-03T10:00:00.000Z' },
          location: 'Smile Clinic',
          htmlLink: 'https://calendar.google.com/event?eid=event-1',
        },
        {
          id: 'event-2',
          summary: 'Focus time',
          calendarId: 'primary',
          start: { dateTime: '2026-05-04T09:00:00.000Z' },
          end: { dateTime: '2026-05-04T10:00:00.000Z' },
        },
      ],
    });
  });

  it('throws when calendar event queries fail', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = err(new Error('calendar-agent unavailable'));
    const executor = createIntexAgentToolExecutor(createExecutorDeps({ calendarClient }));
    const queryCalendarEvents = executor.queryCalendarEvents;
    if (queryCalendarEvents === undefined) {
      throw new Error('queryCalendarEvents should be configured');
    }

    await expect(
      queryCalendarEvents({
        mode: 'count',
        timeMin: '2026-05-01T00:00:00.000Z',
        timeMax: '2026-06-01T00:00:00.000Z',
      })
    ).rejects.toThrow('Failed to query calendar events: calendar-agent unavailable');
  });

  it('creates research drafts through the research client', async () => {
    const researchClient = new FakeResearchClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      researchClient,
    }));

    const result = await executor.createResearch({
      title: 'GPU cloud pricing',
      prompt: 'Research current GPU cloud pricing for small teams.',
      originalMessage: 'Please research current GPU cloud pricing for small teams.',
      sourceMessageIds: ['wamid-research'],
    });

    expect(researchClient.calls).toEqual([
      {
        userId: 'user-1',
        title: 'GPU cloud pricing',
        prompt: 'Research current GPU cloud pricing for small teams.',
        originalMessage: 'Please research current GPU cloud pricing for small teams.',
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      message: 'Research draft created',
      resourceUrl: '/research/research-1',
    });
  });

  it('uses the research prompt as the original message when no original message is provided', async () => {
    const researchClient = new FakeResearchClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      researchClient,
    }));

    await executor.createResearch({
      title: 'GPU cloud pricing',
      prompt: 'Research current GPU cloud pricing for small teams.',
    });

    expect(researchClient.calls[0]).toMatchObject({
      originalMessage: 'Research current GPU cloud pricing for small teams.',
    });
  });

  it('omits absent research resource URLs from tool feedback', async () => {
    const researchClient = new FakeResearchClient();
    researchClient.result = ok({
      status: 'completed',
      message: 'Research draft created',
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      researchClient,
    }));

    const result = await executor.createResearch({
      title: 'GPU cloud pricing',
      prompt: 'Research current GPU cloud pricing for small teams.',
    });

    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      message: 'Research draft created',
    });
  });

  it('throws when research-agent returns failed service feedback', async () => {
    const researchClient = new FakeResearchClient();
    researchClient.result = ok({
      status: 'failed',
      message: 'Research agent unavailable',
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      researchClient,
    }));

    await expect(
      executor.createResearch({
        title: 'GPU cloud pricing',
        prompt: 'Research current GPU cloud pricing for small teams.',
      })
    ).rejects.toThrow('Failed to create research: Research agent unavailable');
  });

  it('throws when research-agent returns an internal client failure', async () => {
    const researchClient = new FakeResearchClient();
    researchClient.result = err(new Error('research-agent unavailable'));
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      researchClient,
    }));

    await expect(
      executor.createResearch({
        title: 'GPU cloud pricing',
        prompt: 'Research current GPU cloud pricing for small teams.',
      })
    ).rejects.toThrow('Failed to create research: research-agent unavailable');
  });

  it('creates links through the bookmarks client with WhatsApp source metadata', async () => {
    const bookmarksClient = new FakeBookmarksClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      bookmarksClient,
    }));

    const result = await executor.createLink({
      url: 'https://example.com/post',
      title: 'Example post',
      description: 'A useful post',
      tags: ['reading'],
      sourceMessageIds: ['wamid-link'],
    });

    expect(bookmarksClient.calls).toEqual([
      {
        userId: 'user-1',
        url: 'https://example.com/post',
        title: 'Example post',
        description: 'A useful post',
        tags: ['reading'],
        source: 'whatsapp',
        sourceId: 'wamid-link',
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      bookmarkId: 'bookmark-1',
      resourceUrl: '/#/bookmarks/bookmark-1',
      url: 'https://example.com/post',
      title: 'Example post',
    });
  });

  it('uses the current WhatsApp message id and empty tags for minimal links', async () => {
    const bookmarksClient = new FakeBookmarksClient();
    bookmarksClient.result = ok({
      id: 'bookmark-2',
      userId: 'user-1',
      url: 'https://example.com/minimal',
      title: null,
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      bookmarksClient,
    }));

    const result = await executor.createLink({
      url: 'https://example.com/minimal',
    });

    expect(bookmarksClient.calls).toEqual([
      {
        userId: 'user-1',
        url: 'https://example.com/minimal',
        tags: [],
        source: 'whatsapp',
        sourceId: 'wamid-1',
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      bookmarkId: 'bookmark-2',
      resourceUrl: '/#/bookmarks/bookmark-2',
      url: 'https://example.com/minimal',
    });
  });

  it('throws when bookmarks-agent returns an internal client failure', async () => {
    const bookmarksClient = new FakeBookmarksClient();
    bookmarksClient.result = err({
      code: 'UNAVAILABLE',
      message: 'bookmarks-agent unavailable',
      status: 503,
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      bookmarksClient,
    }));

    await expect(
      executor.createLink({
        url: 'https://example.com/post',
      })
    ).rejects.toThrow('Failed to create link: bookmarks-agent unavailable');
  });

  it('creates normalized planning code tasks without sending omitted worker types', async () => {
    const codeClient = new FakeCodeTaskClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      codeClient,
    }));

    const result = await executor.createCodeTask({
      prompt: 'Plan the new import flow.',
      linearIssueId: 'LIN-123',
      taskMode: 'planning',
    });

    expect(codeClient.calls).toEqual([
      {
        userId: 'user-1',
        prompt: 'Plan the new import flow.',
        linearIssueId: 'LIN-123',
        taskMode: 'planning',
      },
    ]);
    expect(codeClient.calls[0]).not.toHaveProperty('workerType');
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      codeTaskId: 'task-1',
      resourceUrl: '/code/tasks/task-1',
    });
  });

  it('forwards explicit code task worker types unchanged', async () => {
    const codeClient = new FakeCodeTaskClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      codeClient,
    }));

    await executor.createCodeTask({
      prompt: 'Plan the new import flow.',
      workerType: 'codex',
      taskMode: 'planning',
    });

    expect(codeClient.calls).toEqual([
      {
        userId: 'user-1',
        prompt: 'Plan the new import flow.',
        workerType: 'codex',
        taskMode: 'planning',
      },
    ]);
  });

  it('creates execution code tasks when explicitly requested', async () => {
    const codeClient = new FakeCodeTaskClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      codeClient,
    }));

    await executor.createCodeTask({
      prompt: 'Implement the new import flow.',
      taskMode: 'execution',
    });

    expect(codeClient.calls).toEqual([
      {
        userId: 'user-1',
        prompt: 'Implement the new import flow.',
        taskMode: 'execution',
      },
    ]);
  });

  it('throws when direct code task creation fails', async () => {
    const codeClient = new FakeCodeTaskClient();
    codeClient.result = err({
      code: 'UNAVAILABLE',
      message: 'Worker is not configured',
      status: 503,
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      codeClient,
    }));

    await expect(
      executor.createCodeTask({
        prompt: 'Plan the new import flow.',
        taskMode: 'planning',
      })
    ).rejects.toThrow('Failed to create code task: Worker is not configured');
  });

  it('saves external content through the configured external save client', async () => {
    const externalSaveClient = new FakeExternalSaveClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      externalSaveClient,
    }));

    const result = await executor.saveExternal({
      message: 'Save externally this LinkedIn note',
      sourceUrl: 'https://example.com/post',
    });

    expect(externalSaveClient.calls).toEqual([
      {
        message: 'Save externally this LinkedIn note',
        sourceUrl: 'https://example.com/post',
      },
    ]);
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      message: 'Saved externally',
    });
  });

  it('saves external content without a source URL when only text is provided', async () => {
    const externalSaveClient = new FakeExternalSaveClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      externalSaveClient,
    }));

    await executor.saveExternal({
      message: 'Upload externally the onboarding detail',
    });

    expect(externalSaveClient.calls).toEqual([
      {
        message: 'Upload externally the onboarding detail',
      },
    ]);
  });

  it('throws when external save is not configured', async () => {
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      externalSaveClient: null,
    }));

    await expect(
      executor.saveExternal({ message: 'Save externally this note' })
    ).rejects.toThrow('External save is not configured');
  });

  it('throws when the external save client fails', async () => {
    const externalSaveClient = new FakeExternalSaveClient();
    externalSaveClient.result = err({
      code: 'HTTP_ERROR',
      message: 'HTTP 403: Forbidden',
    });
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      externalSaveClient,
    }));

    await expect(
      executor.saveExternal({ message: 'Save externally this note' })
    ).rejects.toThrow('Failed to save externally: HTTP 403: Forbidden');
  });

  it('reads current prompt preferences through the prompt preferences repository', async () => {
    const promptPreferencesRepository = new FakePromptPreferencesRepository();
    promptPreferencesRepository.seed('user-1', {
      text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      id: 'pref_jakub',
    });
    const executor = createIntexAgentToolExecutor(
      createExecutorDeps({ promptPreferencesRepository })
    );

    const result = await executor.getUserPreferences();

    expect(promptPreferencesRepository.calls[0]).toEqual({ method: 'getCurrent', userId: 'user-1' });
    expect(JSON.parse(result)).toEqual({
      status: 'completed',
      currentVersion: 1,
      promptBlock:
        'User Preferences v1:\n1. (id: pref_jakub) "When I ask to invite Jakub, invite jakub@gmail.com."',
    });
  });

  it('mutates prompt preferences with authenticated session metadata', async () => {
    const promptPreferencesRepository = new FakePromptPreferencesRepository();
    const executor = createIntexAgentToolExecutor(
      createExecutorDeps({ promptPreferencesRepository, sessionId: 'session-1' })
    );

    const addResult = await executor.addUserPreference({
      text: 'When I ask to invite Jakub, invite jakub@gmail.com.',
      expectedVersion: 0,
    });
    const updateResult = await executor.updateUserPreference({
      itemId: 'pref_1',
      text: 'When I ask to invite Jakub, invite jakub.nowak@gmail.com.',
      expectedVersion: 1,
    });
    const deleteResult = await executor.deleteUserPreference({
      itemId: 'pref_1',
      expectedVersion: 2,
    });

    expect(promptPreferencesRepository.calls).toMatchObject([
      {
        method: 'addItem',
        input: {
          userId: 'user-1',
          expectedVersion: 0,
          updatedBy: { actor: 'agent_tool', userId: 'user-1', sessionId: 'session-1', messageId: 'wamid-1' },
        },
      },
      {
        method: 'updateItem',
        input: {
          userId: 'user-1',
          itemId: 'pref_1',
          expectedVersion: 1,
          updatedBy: { actor: 'agent_tool', userId: 'user-1', sessionId: 'session-1', messageId: 'wamid-1' },
        },
      },
      {
        method: 'deleteItem',
        input: {
          userId: 'user-1',
          itemId: 'pref_1',
          expectedVersion: 2,
          updatedBy: { actor: 'agent_tool', userId: 'user-1', sessionId: 'session-1', messageId: 'wamid-1' },
        },
      },
    ]);
    expect(JSON.parse(addResult)).toMatchObject({
      status: 'completed',
      currentVersion: 1,
      changedItemId: 'pref_1',
      promptBlock:
        'User Preferences v1:\n1. (id: pref_1) "When I ask to invite Jakub, invite jakub@gmail.com."',
    });
    expect(JSON.parse(updateResult)).toMatchObject({
      status: 'completed',
      currentVersion: 2,
      changedItemId: 'pref_1',
      promptBlock:
        'User Preferences v2:\n1. (id: pref_1) "When I ask to invite Jakub, invite jakub.nowak@gmail.com."',
    });
    expect(JSON.parse(deleteResult)).toMatchObject({
      status: 'completed',
      currentVersion: 3,
      changedItemId: 'pref_1',
      promptBlock: '',
    });
  });

  it('retries addUserPreference once after refreshing a version-conflicted empty aggregate', async () => {
    const promptPreferencesRepository = new FakePromptPreferencesRepository();
    promptPreferencesRepository.replaceCurrent(createVersionedEmptyCurrent());
    const executor = createIntexAgentToolExecutor(
      createExecutorDeps({ promptPreferencesRepository })
    );

    const result = await executor.addUserPreference({
      text: 'Prefer concise replies.',
      expectedVersion: 0,
    });

    expect(promptPreferencesRepository.calls).toEqual([
      {
        method: 'addItem',
        input: {
          userId: 'user-1',
          text: 'Prefer concise replies.',
          expectedVersion: 0,
          updatedBy: {
            actor: 'agent_tool',
            userId: 'user-1',
            sessionId: 'session-1',
            messageId: 'wamid-1',
          },
        },
      },
      { method: 'getCurrent', userId: 'user-1' },
      {
        method: 'addItem',
        input: {
          userId: 'user-1',
          text: 'Prefer concise replies.',
          expectedVersion: 2,
          updatedBy: {
            actor: 'agent_tool',
            userId: 'user-1',
            sessionId: 'session-1',
            messageId: 'wamid-1',
          },
        },
      },
    ]);
    expect(JSON.parse(result)).toMatchObject({
      status: 'completed',
      currentVersion: 3,
      changedItemId: 'pref_1',
    });
  });

  it('does not retry addUserPreference when the add failure is not a version conflict', async () => {
    const promptPreferencesRepository = new FakePromptPreferencesRepository();
    promptPreferencesRepository.failNextAddWith(new Error('storage unavailable'));
    const executor = createIntexAgentToolExecutor(
      createExecutorDeps({ promptPreferencesRepository })
    );

    await expect(
      executor.addUserPreference({
        text: 'Prefer concise replies.',
        expectedVersion: 0,
      })
    ).rejects.toThrow('storage unavailable');
    expect(promptPreferencesRepository.calls).toEqual([
      {
        method: 'addItem',
        input: {
          userId: 'user-1',
          text: 'Prefer concise replies.',
          expectedVersion: 0,
          updatedBy: {
            actor: 'agent_tool',
            userId: 'user-1',
            sessionId: 'session-1',
            messageId: 'wamid-1',
          },
        },
      },
    ]);
  });

  it('does not retry stale updateUserPreference or deleteUserPreference conflicts', async () => {
    const updatePromptPreferencesRepository = new FakePromptPreferencesRepository();
    updatePromptPreferencesRepository.replaceCurrent(createVersionedEmptyCurrent());
    const updateExecutor = createIntexAgentToolExecutor(
      createExecutorDeps({ promptPreferencesRepository: updatePromptPreferencesRepository })
    );

    await expect(
      updateExecutor.updateUserPreference({
        itemId: 'pref_1',
        text: 'Prefer medium-length replies.',
        expectedVersion: 1,
      })
    ).rejects.toThrow('Expected preference version 1, but current version is 2');
    expect(updatePromptPreferencesRepository.calls).toEqual([
      {
        method: 'updateItem',
        input: {
          userId: 'user-1',
          itemId: 'pref_1',
          text: 'Prefer medium-length replies.',
          expectedVersion: 1,
          updatedBy: {
            actor: 'agent_tool',
            userId: 'user-1',
            sessionId: 'session-1',
            messageId: 'wamid-1',
          },
        },
      },
    ]);

    const deletePromptPreferencesRepository = new FakePromptPreferencesRepository();
    deletePromptPreferencesRepository.replaceCurrent(createVersionedEmptyCurrent());
    const deleteExecutor = createIntexAgentToolExecutor(
      createExecutorDeps({ promptPreferencesRepository: deletePromptPreferencesRepository })
    );

    await expect(
      deleteExecutor.deleteUserPreference({
        itemId: 'pref_1',
        expectedVersion: 1,
      })
    ).rejects.toThrow('Expected preference version 1, but current version is 2');
    expect(deletePromptPreferencesRepository.calls).toEqual([
      {
        method: 'deleteItem',
        input: {
          userId: 'user-1',
          itemId: 'pref_1',
          expectedVersion: 1,
          updatedBy: {
            actor: 'agent_tool',
            userId: 'user-1',
            sessionId: 'session-1',
            messageId: 'wamid-1',
          },
        },
      },
    ]);
  });

  it('throws when an internal tool client returns a failure', async () => {
    const notesClient = new FakeNotesClient();
    notesClient.result = err(new Error('notes-agent unavailable'));
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      notesClient,
    }));

    await expect(executor.createNote({ content: 'remember this' })).rejects.toThrow(
      'Failed to create note: notes-agent unavailable'
    );
  });
});

function createExecutorDeps(
  overrides: Partial<CreateIntexAgentToolExecutorDeps> = {}
): CreateIntexAgentToolExecutorDeps {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    messageId: 'wamid-1',
    notesClient: new FakeNotesClient(),
    calendarClient: new FakeCalendarClient(),
    researchClient: new FakeResearchClient(),
    bookmarksClient: new FakeBookmarksClient(),
    codeClient: new FakeCodeTaskClient(),
    externalSaveClient: new FakeExternalSaveClient(),
    promptPreferencesRepository: new FakePromptPreferencesRepository(),
    ...overrides,
  };
}

class FakeNotesClient implements NotesToolClient {
  readonly calls: Parameters<NotesToolClient['createNote']>[0][] = [];
  result: Result<ServiceFeedback> = ok({
    status: 'completed',
    message: 'Note saved',
    resourceUrl: '/notes/note-1',
  });

  createNote(input: Parameters<NotesToolClient['createNote']>[0]): Promise<Result<ServiceFeedback>> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }
}

class FakeResearchClient implements ResearchToolClient {
  readonly calls: Parameters<ResearchToolClient['createDraft']>[0][] = [];
  result: Result<ServiceFeedback> = ok({
    status: 'completed',
    message: 'Research draft created',
    resourceUrl: '/research/research-1',
  });

  createDraft(
    input: Parameters<ResearchToolClient['createDraft']>[0]
  ): Promise<Result<ServiceFeedback>> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }
}

class FakeBookmarksClient implements BookmarksToolClient {
  readonly calls: Parameters<BookmarksToolClient['createBookmark']>[0][] = [];
  result: Result<CreateBookmarkResponse, CreateBookmarkError> = ok({
    id: 'bookmark-1',
    userId: 'user-1',
    url: 'https://example.com/post',
    title: 'Example post',
  });

  createBookmark(
    input: Parameters<BookmarksToolClient['createBookmark']>[0]
  ): Promise<Result<CreateBookmarkResponse, CreateBookmarkError>> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }
}

class FakeCodeTaskClient implements CodeTaskToolClient {
  readonly calls: Parameters<CodeTaskToolClient['createCodeTask']>[0][] = [];
  result: Result<SubmitTaskResponse, SubmitTaskError> = ok({
    codeTaskId: 'task-1',
    resourceUrl: '/code/tasks/task-1',
  });

  createCodeTask(
    input: Parameters<CodeTaskToolClient['createCodeTask']>[0]
  ): Promise<Result<SubmitTaskResponse, SubmitTaskError>> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }
}

class FakeCalendarClient implements CalendarToolClient {
  readonly calls: Parameters<CalendarToolClient['createEvent']>[0][] = [];
  readonly listCalls: ListCalendarEventsRequest[] = [];
  readonly updateCalls: Parameters<CalendarToolClient['updateEvent']>[0][] = [];
  result: Result<CreatedCalendarEvent> = ok({
    id: 'calendar-event-1',
    summary: 'Dentist appointment',
    start: {
      dateTime: '2026-06-25T09:00:00.000Z',
      timeZone: 'Europe/Warsaw',
    },
    end: {
      dateTime: '2026-06-25T10:00:00.000Z',
      timeZone: 'Europe/Warsaw',
    },
    htmlLink: 'https://calendar.google.com/event?eid=calendar-event-1',
  });
  listResult: Result<{ events: CalendarQueryEvent[]; truncated: boolean }> = ok({
    events: [],
    truncated: false,
  });
  updateResult: Result<CreatedCalendarEvent> = this.result;

  createEvent(
    input: Parameters<CalendarToolClient['createEvent']>[0]
  ): Promise<Result<CreatedCalendarEvent>> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }

  listEvents(
    input: ListCalendarEventsRequest
  ): Promise<Result<{ events: CalendarQueryEvent[]; truncated: boolean }>> {
    this.listCalls.push(input);
    return Promise.resolve(this.listResult);
  }

  updateEvent(
    input: Parameters<CalendarToolClient['updateEvent']>[0]
  ): Promise<Result<CreatedCalendarEvent>> {
    this.updateCalls.push(input);
    return Promise.resolve(this.updateResult);
  }
}

class FakeExternalSaveClient implements ExternalSaveToolClient {
  readonly calls: Parameters<ExternalSaveToolClient['save']>[0][] = [];
  result: Result<{ status: 'completed'; message: string }, { code: string; message: string }> = ok({
    status: 'completed',
    message: 'Saved externally',
  });

  save(input: Parameters<ExternalSaveToolClient['save']>[0]): Promise<Result<{ status: 'completed'; message: string }, { code: string; message: string }>> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }
}

class FakePromptPreferencesRepository implements PromptPreferencesRepository {
  readonly calls: unknown[] = [];
  private current = emptyPromptPreferences('user-1');
  private versions: IntexAgentPromptPreferenceVersion[] = [];
  private idCounter = 0;
  private timeCounter = 0;
  private nextAddError: Error | null = null;

  replaceCurrent(current: IntexAgentPromptPreferences): void {
    this.current = current;
  }

  failNextAddWith(error: Error): void {
    this.nextAddError = error;
  }

  seed(userId: string, input: { id: string; text: string }): void {
    const result = addPromptPreferenceItem(emptyPromptPreferences(userId), {
      id: input.id,
      text: input.text,
      now: '2026-06-28T10:00:00.000Z',
      updatedBy: { actor: 'web_ui', userId },
    });
    this.current = result.current;
    this.versions = [result.version];
  }

  async getCurrent(userId: string): Promise<IntexAgentPromptPreferences> {
    this.calls.push({ method: 'getCurrent', userId });
    return this.current.userId === userId ? this.current : emptyPromptPreferences(userId);
  }

  async listVersions(): Promise<never[]> {
    return [];
  }

  async getVersion(): Promise<null> {
    return null;
  }

  async addItem(
    input: Parameters<PromptPreferencesRepository['addItem']>[0]
  ): Promise<IntexAgentPromptPreferences> {
    this.calls.push({ method: 'addItem', input });
    if (this.nextAddError !== null) {
      const error = this.nextAddError;
      this.nextAddError = null;
      throw error;
    }
    assertExpectedPromptPreferenceVersion(this.current, input.expectedVersion);
    const result = addPromptPreferenceItem(this.current, {
      id: `pref_${String(++this.idCounter)}`,
      text: input.text,
      now: this.nextTime(),
      updatedBy: input.updatedBy,
    });
    this.current = result.current;
    this.versions.push(result.version);
    return result.current;
  }

  async updateItem(
    input: Parameters<PromptPreferencesRepository['updateItem']>[0]
  ): Promise<IntexAgentPromptPreferences> {
    this.calls.push({ method: 'updateItem', input });
    assertExpectedPromptPreferenceVersion(this.current, input.expectedVersion);
    const result = updatePromptPreferenceItem(this.current, {
      itemId: input.itemId,
      text: input.text,
      now: this.nextTime(),
      updatedBy: input.updatedBy,
    });
    this.current = result.current;
    this.versions.push(result.version);
    return result.current;
  }

  async deleteItem(
    input: Parameters<PromptPreferencesRepository['deleteItem']>[0]
  ): Promise<IntexAgentPromptPreferences> {
    this.calls.push({ method: 'deleteItem', input });
    assertExpectedPromptPreferenceVersion(this.current, input.expectedVersion);
    const result = deletePromptPreferenceItem(this.current, {
      itemId: input.itemId,
      now: this.nextTime(),
      updatedBy: input.updatedBy,
    });
    this.current = result.current;
    this.versions.push(result.version);
    return result.current;
  }

  private nextTime(): string {
    this.timeCounter += 1;
    return `2026-06-28T10:0${String(this.timeCounter)}:00.000Z`;
  }
}

function createVersionedEmptyCurrent(): IntexAgentPromptPreferences {
  const added = addPromptPreferenceItem(emptyPromptPreferences('user-1'), {
    id: 'pref_1',
    text: 'Prefer concise replies.',
    now: '2026-06-28T10:00:00.000Z',
    updatedBy: { actor: 'web_ui', userId: 'user-1' },
  });
  return deletePromptPreferenceItem(added.current, {
    itemId: 'pref_1',
    now: '2026-06-28T10:01:00.000Z',
    updatedBy: { actor: 'web_ui', userId: 'user-1' },
  }).current;
}

function event(id: string, summary: string, startDateTime: string): CalendarQueryEvent {
  const endDate = new Date(startDateTime);
  endDate.setUTCHours(endDate.getUTCHours() + 1);
  return {
    id,
    summary,
    start: { dateTime: startDateTime },
    end: { dateTime: endDate.toISOString() },
  };
}
