import { err, ok, type Result, type ServiceFeedback } from '@intexuraos/common-core';
import type { CreatedCalendarEvent } from '@intexuraos/internal-clients';
import { describe, expect, it } from 'vitest';
import { createIntexAgentToolExecutor } from '../../domain/agent/toolExecutor.js';
import type {
  CalendarToolClient,
  NotesToolClient,
} from '../../domain/agent/toolExecutor.js';

describe('createIntexAgentToolExecutor', () => {
  it('creates notes through the notes client with WhatsApp source metadata', async () => {
    const notesClient = new FakeNotesClient();
    const executor = createIntexAgentToolExecutor({
      userId: 'user-1',
      messageId: 'wamid-1',
      notesClient,
      calendarClient: new FakeCalendarClient(),
    });

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
    const executor = createIntexAgentToolExecutor({
      userId: 'user-1',
      messageId: 'wamid-1',
      notesClient,
      calendarClient: new FakeCalendarClient(),
    });

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
    const executor = createIntexAgentToolExecutor({
      userId: 'user-1',
      messageId: 'wamid-1',
      notesClient,
      calendarClient: new FakeCalendarClient(),
    });

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
    const executor = createIntexAgentToolExecutor({
      userId: 'user-1',
      messageId: 'wamid-1',
      notesClient,
      calendarClient: new FakeCalendarClient(),
    });

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
    const executor = createIntexAgentToolExecutor({
      userId: 'user-1',
      messageId: 'wamid-1',
      notesClient,
      calendarClient: new FakeCalendarClient(),
    });

    await expect(executor.createNote({ content: 'remember this' })).rejects.toThrow(
      'Failed to create note: Notion token missing'
    );
  });

  it('creates calendar events through the calendar client', async () => {
    const calendarClient = new FakeCalendarClient();
    const executor = createIntexAgentToolExecutor({
      userId: 'user-1',
      messageId: 'wamid-1',
      notesClient: new FakeNotesClient(),
      calendarClient,
    });

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
    const executor = createIntexAgentToolExecutor({
      userId: 'user-1',
      messageId: 'wamid-1',
      notesClient: new FakeNotesClient(),
      calendarClient,
    });

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
    const executor = createIntexAgentToolExecutor({
      userId: 'user-1',
      messageId: 'wamid-1',
      notesClient: new FakeNotesClient(),
      calendarClient,
    });

    await expect(
      executor.createCalendarEvent({
        summary: 'Dentist appointment',
        start: '2026-06-25T09:00:00.000Z',
        end: '2026-06-25T10:00:00.000Z',
      })
    ).rejects.toThrow('Failed to create calendar event: calendar-agent unavailable');
  });

  it('throws when an internal tool client returns a failure', async () => {
    const notesClient = new FakeNotesClient();
    notesClient.result = err(new Error('notes-agent unavailable'));
    const executor = createIntexAgentToolExecutor({
      userId: 'user-1',
      messageId: 'wamid-1',
      notesClient,
      calendarClient: new FakeCalendarClient(),
    });

    await expect(executor.createNote({ content: 'remember this' })).rejects.toThrow(
      'Failed to create note: notes-agent unavailable'
    );
  });
});

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

class FakeCalendarClient implements CalendarToolClient {
  readonly calls: Parameters<CalendarToolClient['createEvent']>[0][] = [];
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

  createEvent(
    input: Parameters<CalendarToolClient['createEvent']>[0]
  ): Promise<Result<CreatedCalendarEvent>> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }
}
