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

  it('counts calendar events through the calendar client', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = ok([
      event('event-1', 'Dentist', '2026-05-03T09:00:00.000Z'),
      event('event-2', 'Dentist follow-up', '2026-05-20T09:00:00.000Z'),
    ]);
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
      timeMin: '2026-05-01T00:00:00.000Z',
      timeMax: '2026-06-01T00:00:00.000Z',
      query: 'Dentist',
    });
  });

  it('marks calendar event counts as truncated when they hit the query cap', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = ok([
      event('event-1', 'Dentist', '2026-05-03T09:00:00.000Z'),
      event('event-2', 'Dentist follow-up', '2026-05-20T09:00:00.000Z'),
    ]);
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
      truncated: true,
    });
  });

  it('lists calendar events through the calendar client with safe event fields', async () => {
    const calendarClient = new FakeCalendarClient();
    calendarClient.listResult = ok([
      {
        ...event('event-1', 'Dentist', '2026-05-03T09:00:00.000Z'),
        location: 'Smile Clinic',
        htmlLink: 'https://calendar.google.com/event?eid=event-1',
        description: 'Private detail',
        status: 'confirmed',
      },
      event('event-2', 'Focus time', '2026-05-04T09:00:00.000Z'),
    ]);
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
      timeMin: '2026-05-01T00:00:00.000Z',
      timeMax: '2026-06-01T00:00:00.000Z',
      events: [
        {
          id: 'event-1',
          summary: 'Dentist',
          start: { dateTime: '2026-05-03T09:00:00.000Z' },
          end: { dateTime: '2026-05-03T10:00:00.000Z' },
          location: 'Smile Clinic',
          htmlLink: 'https://calendar.google.com/event?eid=event-1',
        },
        {
          id: 'event-2',
          summary: 'Focus time',
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

  it('creates planning code tasks by default without sending omitted worker types', async () => {
    const codeClient = new FakeCodeTaskClient();
    const executor = createIntexAgentToolExecutor(createExecutorDeps({
      codeClient,
    }));

    const result = await executor.createCodeTask({
      prompt: 'Plan the new import flow.',
      linearIssueId: 'LIN-123',
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
    messageId: 'wamid-1',
    notesClient: new FakeNotesClient(),
    calendarClient: new FakeCalendarClient(),
    researchClient: new FakeResearchClient(),
    bookmarksClient: new FakeBookmarksClient(),
    codeClient: new FakeCodeTaskClient(),
    externalSaveClient: new FakeExternalSaveClient(),
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
  listResult: Result<CalendarQueryEvent[]> = ok([]);

  createEvent(
    input: Parameters<CalendarToolClient['createEvent']>[0]
  ): Promise<Result<CreatedCalendarEvent>> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }

  listEvents(input: ListCalendarEventsRequest): Promise<Result<CalendarQueryEvent[]>> {
    this.listCalls.push(input);
    return Promise.resolve(this.listResult);
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
