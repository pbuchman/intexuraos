import { describe, expect, it } from 'vitest';
import {
  createIntexAgentToolDefinitions,
  type CreateCodeTaskToolArgs,
  type IntexAgentToolExecutor,
} from '../../domain/agent/toolDefinitions.js';

describe('createIntexAgentToolDefinitions', () => {
  it('requires task mode on normalized code-task arguments', () => {
    const taskModeIsRequired: CreateCodeTaskToolArgs extends {
      taskMode: 'planning' | 'execution';
    }
      ? true
      : false = true;

    expect(taskModeIsRequired).toBe(true);
  });

  it('defines exactly the supported tools', () => {
    const tools = createIntexAgentToolDefinitions(createExecutor());

    expect(tools.map((tool) => tool.name)).toEqual([
      'create_note',
      'create_calendar_event',
      'query_calendar_events',
      'update_calendar_event',
      'create_research',
      'create_link',
      'create_code_task',
      'save_external',
      'get_user_preferences',
      'add_user_preference',
      'update_user_preference',
      'delete_user_preference',
    ]);
  });

  it('describes when to create a note', () => {
    const [noteTool] = createIntexAgentToolDefinitions(createExecutor());

    expect(noteTool?.description).toContain('remember');
    expect(noteTool?.description).toContain('save');
    expect(noteTool?.description).toContain('note');
    expect(noteTool?.parameters['required']).toEqual(['content']);
  });

  it('describes when to create a calendar event and when to ask for clarification first', () => {
    const calendarTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'create_calendar_event'
    );

    expect(calendarTool?.description).toContain('calendar');
    expect(calendarTool?.description).toContain('appointment');
    expect(calendarTool?.description).toContain('meeting');
    expect(calendarTool?.description).toContain('explicit duration');
    expect(calendarTool?.description).toContain('visible 60-minute default');
    expect(calendarTool?.description).toContain('same final confirmation');
    expect(calendarTool?.description).toContain('Never put analysis or uncertainty into summary');
    expect(calendarTool?.description).toContain('date');
    expect(calendarTool?.description).toContain('time');
    expect(calendarTool?.parameters['required']).toEqual(['summary', 'start', 'end']);
  });

  it('describes read-only calendar event queries', () => {
    const calendarQueryTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'query_calendar_events'
    );

    expect(calendarQueryTool?.description).toContain('read-only');
    expect(calendarQueryTool?.description).toContain('list');
    expect(calendarQueryTool?.description).toContain('count');
    expect(calendarQueryTool?.description).toContain('lookup before update_calendar_event');
    expect(calendarQueryTool?.description).not.toContain(
      'Do not use for: scheduling, canceling, updating, deleting, or rescheduling calendar events.'
    );
    expect(calendarQueryTool?.parameters['required']).toEqual(['mode', 'timeMin', 'timeMax']);
    expect(calendarQueryTool?.parameters['properties']).toMatchObject({
      maxResults: {
        type: 'integer',
        minimum: 1,
        maximum: 2500,
      },
    });
  });

  it('describes general updates for existing calendar events', () => {
    const calendarUpdateTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'update_calendar_event'
    );

    expect(calendarUpdateTool?.description).toContain('existing');
    expect(calendarUpdateTool?.description).toContain('title');
    expect(calendarUpdateTool?.description).toContain('time');
    expect(calendarUpdateTool?.description).toContain('location');
    expect(calendarUpdateTool?.description).toContain('description');
    expect(calendarUpdateTool?.description).toContain('attendee');
    expect(calendarUpdateTool?.description).toContain('query_calendar_events');
    expect(calendarUpdateTool?.description).toContain('confirmation');
    expect(calendarUpdateTool?.parameters['required']).toEqual(['eventId', 'eventSummary', 'changes']);
    expect(calendarUpdateTool?.parameters['properties']).toMatchObject({
      changes: {
        type: 'object',
        additionalProperties: false,
      },
    });
  });

  it('does not expose unsupported work as a tool', () => {
    const toolNames = createIntexAgentToolDefinitions(createExecutor()).map((tool) => tool.name);

    expect(toolNames).not.toContain('book_uber');
    expect(toolNames).not.toContain('create_reminder');
    expect(toolNames).not.toContain('send_email');
  });

  it('uses the required model-readable description sections for every tool', () => {
    const tools = createIntexAgentToolDefinitions(createExecutor());

    for (const tool of tools) {
      expect(tool.description).toContain('Purpose:');
      expect(tool.description).toContain('Use for:');
      expect(tool.description).toContain('Do not use for:');
      expect(tool.description).toContain('Required input:');
      expect(tool.description).toContain('Boundary:');
      expect(tool.description).toContain('Examples:');
      expect(tool.description).toContain('Result:');
      expect(tool.description).toContain('Errors:');
    }
  });

  it('describes research creation', () => {
    const researchTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'create_research'
    );

    expect(researchTool?.description).toContain('research');
    expect(researchTool?.description).toContain('draft');
    expect(researchTool?.parameters['required']).toEqual(['title', 'prompt']);
  });

  it('describes link creation', () => {
    const linkTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'create_link'
    );

    expect(linkTool?.description).toContain('link');
    expect(linkTool?.description).toContain('bookmark');
    expect(linkTool?.description).toContain('bare URL');
    expect(linkTool?.description).toContain('Never fetch, read, title, summarize, or inspect');
    expect(linkTool?.description).toContain('create a research draft from this URL');
    expect(linkTool?.parameters['required']).toEqual(['url']);
  });

  it('describes code task creation and task mode semantics', () => {
    const codeTaskTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'create_code_task'
    );

    expect(codeTaskTool?.description).toContain('code');
    expect(codeTaskTool?.description).toContain('planning');
    expect(codeTaskTool?.description).toContain('execution');
    expect(codeTaskTool?.parameters['required']).toEqual(['prompt']);
    expect(codeTaskTool?.parameters['properties']).toMatchObject({
      taskMode: {
        type: 'string',
        enum: ['planning', 'execution'],
      },
    });
  });

  it('describes code task worker types as optional explicit choices', () => {
    const codeTaskTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'create_code_task'
    );

    expect(codeTaskTool?.parameters['required']).toEqual(['prompt']);
    expect(codeTaskTool?.parameters['required']).not.toContain('workerType');
    expect(codeTaskTool?.parameters['properties']).toMatchObject({
      workerType: {
        type: 'string',
        enum: ['codex', 'codex-xhigh', 'openrouter-free'],
        description: expect.stringMatching(
          /only when explicitly requested.*Codex.*codex.*Codex extra high.*codex-xhigh.*OpenRouter Free.*openrouter-free/
        ),
      },
    });
  });

  it('allows a Linear issue only when the user explicitly associates an identifier with Linear', () => {
    const codeTaskTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'create_code_task'
    );

    expect(codeTaskTool?.parameters['required']).not.toContain('linearIssueId');
    expect(codeTaskTool?.description).toContain(
      'Set linearIssueId only when the user explicitly associates a supplied identifier with a Linear issue or ticket.'
    );
    expect(codeTaskTool?.description).toContain(
      'An arbitrary opaque identifier, tracking marker, or evaluation marker is not enough'
    );
    expect(codeTaskTool?.parameters['properties']).toMatchObject({
      linearIssueId: {
        type: 'string',
        description: expect.stringContaining(
          'Set only when the user explicitly associates the supplied identifier with a Linear issue or ticket.'
        ),
      },
    });
    expect(codeTaskTool?.parameters['properties']).toMatchObject({
      linearIssueId: {
        description: expect.stringContaining(
          'An arbitrary opaque identifier, tracking marker, or evaluation marker is not enough'
        ),
      },
    });
  });

  it('describes external save forwarding without inspecting URLs', () => {
    const externalSaveTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'save_external'
    );

    expect(externalSaveTool?.description).toContain('external');
    expect(externalSaveTool?.description).toContain('Do not fetch');
    expect(externalSaveTool?.parameters['required']).toEqual(['message']);
    expect(externalSaveTool?.parameters['properties']).toMatchObject({
      message: { type: 'string' },
      sourceUrl: { type: 'string' },
    });
  });

  it('describes itemized prompt preference management tools', () => {
    const tools = createIntexAgentToolDefinitions(createExecutor());
    const getTool = tools.find((tool) => tool.name === 'get_user_preferences');
    const addTool = tools.find((tool) => tool.name === 'add_user_preference');
    const updateTool = tools.find((tool) => tool.name === 'update_user_preference');
    const deleteTool = tools.find((tool) => tool.name === 'delete_user_preference');

    expect(getTool?.description).toContain('defined');
    expect(getTool?.description).toContain('No full system prompt');
    expect(addTool?.description).toContain('reply in Polish unless I ask otherwise');
    expect(addTool?.description).toContain('dry irony');
    expect(addTool?.description).toContain('be shorter');
    expect(updateTool?.description).toContain('Do not guess');
    expect(updateTool?.description).toContain('separate read-only turn');
    expect(updateTool?.description).toContain('do not chain');
    expect(deleteTool?.description).toContain('stop being so formal');
    expect(deleteTool?.description).toContain('separate read-only turn');
    expect(deleteTool?.description).toContain('do not chain');
    expect(addTool?.parameters['required']).toEqual(['text', 'expectedVersion']);
    expect(updateTool?.parameters['required']).toEqual(['itemId', 'text', 'expectedVersion']);
    expect(deleteTool?.parameters['required']).toEqual(['itemId', 'expectedVersion']);
  });

  it('keeps code task worker type optional while accepting supported explicit values', async () => {
    const executor = createExecutor();
    const codeTaskTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_code_task'
    );

    await expect(
      codeTaskTool?.run({
        prompt: 'Implement the new import flow.',
        workerType: 'codex-xhigh',
        linearIssueId: 'LIN-123',
        taskMode: 'execution',
      })
    ).resolves.toBe('code-task-created');
    expect(executor.codeTaskArgs).toEqual([
      {
        prompt: 'Implement the new import flow.',
        workerType: 'codex-xhigh',
        linearIssueId: 'LIN-123',
        taskMode: 'execution',
      },
    ]);
  });

  it('delegates note execution to the injected executor', async () => {
    const executor = createExecutor();
    const [noteTool] = createIntexAgentToolDefinitions(executor);

    await expect(noteTool?.run({ content: 'garage code is 7241', title: 'Garage' })).resolves.toBe(
      'note-created'
    );
    expect(executor.noteArgs).toEqual([{ content: 'garage code is 7241', title: 'Garage' }]);
  });

  it('passes optional note metadata when provided', async () => {
    const executor = createExecutor();
    const [noteTool] = createIntexAgentToolDefinitions(executor);

    await expect(
      noteTool?.run({
        content: 'garage code is 7241',
        title: 'Garage',
        tags: ['home', 'access'],
        sourceMessageIds: ['wamid-1'],
      })
    ).resolves.toBe('note-created');
    expect(executor.noteArgs).toEqual([
      {
        content: 'garage code is 7241',
        title: 'Garage',
        tags: ['home', 'access'],
        sourceMessageIds: ['wamid-1'],
      },
    ]);
  });

  it('delegates minimal note arguments without optional metadata', async () => {
    const executor = createExecutor();
    const [noteTool] = createIntexAgentToolDefinitions(executor);

    await expect(noteTool?.run({ content: 'garage code is 7241' })).resolves.toBe(
      'note-created'
    );
    expect(executor.noteArgs).toEqual([{ content: 'garage code is 7241' }]);
  });

  it('delegates calendar execution to the injected executor', async () => {
    const executor = createExecutor();
    const calendarTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_calendar_event'
    );

    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-08-18T14:30:00+02:00',
        end: '2026-08-18T15:15:00+02:00',
        location: 'Smile Clinic',
      })
    ).resolves.toBe('calendar-created');
    expect(executor.calendarArgs).toEqual([
      {
        summary: 'Dentist',
        start: '2026-08-18T14:30:00+02:00',
        end: '2026-08-18T15:15:00+02:00',
        location: 'Smile Clinic',
      },
    ]);
  });

  it('passes optional calendar event fields when provided', async () => {
    const executor = createExecutor();
    const calendarTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_calendar_event'
    );

    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-08-18T14:30:00+02:00',
        end: '2026-08-18T15:15:00+02:00',
        timeZone: 'Europe/Warsaw',
        location: 'Smile Clinic',
        description: 'Annual checkup',
        attendees: ['assistant@example.com'],
      })
    ).resolves.toBe('calendar-created');
    expect(executor.calendarArgs).toEqual([
      {
        summary: 'Dentist',
        start: '2026-08-18T14:30:00+02:00',
        end: '2026-08-18T15:15:00+02:00',
        timeZone: 'Europe/Warsaw',
        location: 'Smile Clinic',
        description: 'Annual checkup',
        attendees: ['assistant@example.com'],
      },
    ]);
  });

  it('delegates minimal calendar arguments without optional metadata', async () => {
    const executor = createExecutor();
    const calendarTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_calendar_event'
    );

    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-08-18T14:30:00+02:00',
        end: '2026-08-18T15:15:00+02:00',
      })
    ).resolves.toBe('calendar-created');
    expect(executor.calendarArgs).toEqual([
      {
        summary: 'Dentist',
        start: '2026-08-18T14:30:00+02:00',
        end: '2026-08-18T15:15:00+02:00',
      },
    ]);
  });

  it('delegates calendar query execution to the injected executor', async () => {
    const executor = createExecutor();
    const calendarQueryTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'query_calendar_events'
    );

    await expect(
      calendarQueryTool?.run({
        mode: 'count',
        timeMin: '2026-05-01T00:00:00.000Z',
        timeMax: '2026-06-01T00:00:00.000Z',
        query: 'Dentist',
        calendarId: 'work',
        maxResults: 50,
      })
    ).resolves.toBe('calendar-query-completed');
    expect(executor.calendarQueryArgs).toEqual([
      {
        mode: 'count',
        timeMin: '2026-05-01T00:00:00.000Z',
        timeMax: '2026-06-01T00:00:00.000Z',
        query: 'Dentist',
        calendarId: 'work',
        maxResults: 50,
      },
    ]);
  });

  it('delegates an existing-event attendee update to the injected executor', async () => {
    const executor = createExecutor();
    const calendarUpdateTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'update_calendar_event'
    );

    await expect(
      calendarUpdateTool?.run({
        eventId: 'event-bagrowa',
        eventSummary: 'Bagrowa',
        attendeesToAdd: ['patryk@example.com'],
        calendarId: 'primary',
        expectedEtag: '"event-bagrowa-v1"',
        eventStart: {
          dateTime: '2026-06-25T18:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
        eventEnd: { date: '2026-06-26' },
      })
    ).resolves.toBe('calendar-updated');
    expect(executor.calendarUpdateArgs).toEqual([
      {
        eventId: 'event-bagrowa',
        eventSummary: 'Bagrowa',
        attendeesToAdd: ['patryk@example.com'],
        calendarId: 'primary',
        expectedEtag: '"event-bagrowa-v1"',
        eventStart: {
          dateTime: '2026-06-25T18:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
        eventEnd: { date: '2026-06-26' },
      },
    ]);
  });

  it('delegates a general existing-event update to the injected executor', async () => {
    const executor = createExecutor();
    const calendarUpdateTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'update_calendar_event'
    );

    await expect(
      calendarUpdateTool?.run({
        eventId: 'event-photos',
        eventSummary: 'Google Photos od 04.2019',
        changes: {
          summary: 'Google Photos archive',
          start: { date: '2026-08-22' },
          end: { date: '2026-08-23' },
          location: null,
          description: 'Cleanup',
          attendeesToAdd: ['new@example.com'],
          attendeesToRemove: ['old@example.com'],
        },
      })
    ).resolves.toBe('calendar-updated');
    expect(executor.calendarUpdateArgs).toEqual([
      {
        eventId: 'event-photos',
        eventSummary: 'Google Photos od 04.2019',
        changes: {
          summary: 'Google Photos archive',
          start: { date: '2026-08-22' },
          end: { date: '2026-08-23' },
          location: null,
          description: 'Cleanup',
          attendeesToAdd: ['new@example.com'],
          attendeesToRemove: ['old@example.com'],
        },
      },
    ]);
  });

  it.each([
    { changes: null, error: 'calendar event changes object' },
    { changes: [], error: 'calendar event changes object' },
    { changes: { unknown: true }, error: 'unsupported field' },
    { changes: { summary: 42 }, error: 'summary must be a string' },
    { changes: { description: 42 }, error: 'description must be a string or null' },
    { changes: { start: 'tomorrow', end: 'later' }, error: 'start must be a calendar date-time object' },
    { changes: {}, error: 'valid calendar event update' },
    { changes: { start: { date: '2026-08-22' } }, error: 'valid calendar event update' },
    {
      changes: { attendeesToRemove: ['not-an-email'] },
      error: 'attendeesToRemove must contain valid email addresses',
    },
  ])('rejects malformed general calendar changes: $changes', async ({ changes, error }) => {
    const calendarUpdateTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'update_calendar_event'
    );

    await expect(
      calendarUpdateTool?.run({
        eventId: 'event-photos',
        eventSummary: 'Google Photos',
        changes,
      })
    ).rejects.toThrow(error);
  });

  it('rejects an attendee update without a target or attendees', async () => {
    const calendarUpdateTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'update_calendar_event'
    );

    await expect(
      calendarUpdateTool?.run({
        eventSummary: 'Bagrowa',
        attendeesToAdd: ['patryk@example.com'],
      })
    ).rejects.toThrow('Tool argument eventId must be a string');
    await expect(
      calendarUpdateTool?.run({
        eventId: 'event-bagrowa',
        eventSummary: 'Bagrowa',
        attendeesToAdd: [],
      })
    ).rejects.toThrow('Tool argument attendeesToAdd must be a non-empty string array');
    await expect(
      calendarUpdateTool?.run({
        eventId: 'event-bagrowa',
        eventSummary: 'Bagrowa',
        attendeesToAdd: ['Patryk'],
      })
    ).rejects.toThrow('Tool argument attendeesToAdd must contain valid email addresses');
    await expect(
      calendarUpdateTool?.run({
        eventId: 'event-bagrowa',
        eventSummary: 'Bagrowa',
        attendeesToAdd: [42],
      })
    ).rejects.toThrow('Tool argument attendeesToAdd must be a non-empty string array');
    await expect(
      calendarUpdateTool?.run({
        eventId: 'event-bagrowa',
        eventSummary: 'Bagrowa',
        attendeesToAdd: ['  '],
      })
    ).rejects.toThrow('Tool argument attendeesToAdd must be a non-empty string array');
  });

  it('rejects malformed optional calendar event snapshots', async () => {
    const calendarUpdateTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'update_calendar_event'
    );
    const baseArgs = {
      eventId: 'event-bagrowa',
      eventSummary: 'Bagrowa',
      attendeesToAdd: ['patryk@example.com'],
    };

    for (const eventStart of [null, 'not-an-object', [], { unexpected: true }, {}]) {
      await expect(calendarUpdateTool?.run({ ...baseArgs, eventStart })).rejects.toThrow(
        'Tool argument eventStart must be a calendar date-time object'
      );
    }
  });

  it('delegates research execution to the injected executor', async () => {
    const executor = createExecutor();
    const researchTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_research'
    );

    await expect(
      researchTool?.run({
        title: 'GPU pricing',
        prompt: 'Research current GPU cloud pricing.',
        originalMessage: 'Please research current GPU cloud pricing.',
        sourceMessageIds: ['wamid-research'],
      })
    ).resolves.toBe('research-created');
    expect(executor.researchArgs).toEqual([
      {
        title: 'GPU pricing',
        prompt: 'Research current GPU cloud pricing.',
        originalMessage: 'Please research current GPU cloud pricing.',
        sourceMessageIds: ['wamid-research'],
      },
    ]);
  });

  it('delegates minimal research arguments without optional metadata', async () => {
    const executor = createExecutor();
    const researchTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_research'
    );

    await expect(
      researchTool?.run({
        title: 'GPU pricing',
        prompt: 'Research current GPU cloud pricing.',
      })
    ).resolves.toBe('research-created');
    expect(executor.researchArgs).toEqual([
      {
        title: 'GPU pricing',
        prompt: 'Research current GPU cloud pricing.',
      },
    ]);
  });

  it('delegates link execution to the injected executor', async () => {
    const executor = createExecutor();
    const linkTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_link'
    );

    await expect(
      linkTool?.run({
        url: 'https://example.com/post',
        title: 'Example post',
        description: 'A useful post',
        tags: ['reading'],
        sourceMessageIds: ['wamid-link'],
      })
    ).resolves.toBe('link-created');
    expect(executor.linkArgs).toEqual([
      {
        url: 'https://example.com/post',
        title: 'Example post',
        description: 'A useful post',
        tags: ['reading'],
        sourceMessageIds: ['wamid-link'],
      },
    ]);
  });

  it('delegates minimal link arguments without optional metadata', async () => {
    const executor = createExecutor();
    const linkTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_link'
    );

    await expect(
      linkTool?.run({
        url: 'https://example.com/post',
      })
    ).resolves.toBe('link-created');
    expect(executor.linkArgs).toEqual([
      {
        url: 'https://example.com/post',
      },
    ]);
  });

  it('delegates code task execution to the injected executor with explicit execution mode', async () => {
    const executor = createExecutor();
    const codeTaskTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_code_task'
    );

    await expect(
      codeTaskTool?.run({
        prompt: 'Implement the new import flow.',
        workerType: 'codex',
        linearIssueId: 'LIN-123',
        taskMode: 'execution',
      })
    ).resolves.toBe('code-task-created');
    expect(executor.codeTaskArgs).toEqual([
      {
        prompt: 'Implement the new import flow.',
        workerType: 'codex',
        linearIssueId: 'LIN-123',
        taskMode: 'execution',
      },
    ]);
  });

  it('normalizes the default planning mode before delegating to the executor', async () => {
    const executor = createExecutor();
    const codeTaskTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_code_task'
    );

    await expect(codeTaskTool?.run({ prompt: 'Plan the new import flow.' })).resolves.toBe(
      'code-task-created'
    );
    expect(executor.codeTaskArgs).toEqual([
      { prompt: 'Plan the new import flow.', taskMode: 'planning' },
    ]);
  });

  it('delegates external save execution to the injected executor', async () => {
    const executor = createExecutor();
    const externalSaveTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'save_external'
    );

    await expect(
      externalSaveTool?.run({
        message: 'Save externally this LinkedIn note',
        sourceUrl: 'https://example.com/post',
      })
    ).resolves.toBe('external-saved');
    expect(executor.externalSaveArgs).toEqual([
      {
        message: 'Save externally this LinkedIn note',
        sourceUrl: 'https://example.com/post',
      },
    ]);
  });

  it('delegates external save execution without optional source URL', async () => {
    const executor = createExecutor();
    const externalSaveTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'save_external'
    );

    await expect(
      externalSaveTool?.run({
        message: 'Save externally this copied note',
      })
    ).resolves.toBe('external-saved');
    expect(executor.externalSaveArgs).toEqual([
      {
        message: 'Save externally this copied note',
      },
    ]);
  });

  it('delegates preference tools to the injected executor', async () => {
    const executor = createExecutor();
    const tools = createIntexAgentToolDefinitions(executor);

    await expect(tools.find((tool) => tool.name === 'get_user_preferences')?.run({})).resolves.toBe(
      'preferences-read'
    );
    await expect(
      tools.find((tool) => tool.name === 'add_user_preference')?.run({
        text: 'When I invite Jakub, use jakub@gmail.com.',
        expectedVersion: 3,
      })
    ).resolves.toBe('preference-added');
    await expect(
      tools.find((tool) => tool.name === 'update_user_preference')?.run({
        itemId: 'pref_1',
        text: 'When I invite Jakub, use jakub.nowak@gmail.com.',
        expectedVersion: 4,
      })
    ).resolves.toBe('preference-updated');
    await expect(
      tools.find((tool) => tool.name === 'delete_user_preference')?.run({
        itemId: 'pref_1',
        expectedVersion: 5,
      })
    ).resolves.toBe('preference-deleted');

    expect(executor.preferenceReadCalls).toBe(1);
    expect(executor.preferenceAddArgs).toEqual([
      {
        text: 'When I invite Jakub, use jakub@gmail.com.',
        expectedVersion: 3,
      },
    ]);
    expect(executor.preferenceUpdateArgs).toEqual([
      {
        itemId: 'pref_1',
        text: 'When I invite Jakub, use jakub.nowak@gmail.com.',
        expectedVersion: 4,
      },
    ]);
    expect(executor.preferenceDeleteArgs).toEqual([
      {
        itemId: 'pref_1',
        expectedVersion: 5,
      },
    ]);
  });

  it('rejects invalid required and optional tool arguments', async () => {
    const [noteTool, calendarTool] = createIntexAgentToolDefinitions(createExecutor());
    const codeTaskTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'create_code_task'
    );

    await expect(noteTool?.run({ content: 123 })).rejects.toThrow(
      'Tool argument content must be a string'
    );
    await expect(noteTool?.run({ content: 'hello', tags: ['ok', 123] })).rejects.toThrow(
      'Tool argument tags must be an array of strings'
    );
    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-08-18T14:30:00+02:00',
        end: '2026-08-18T15:15:00+02:00',
        timeZone: 123,
      })
    ).rejects.toThrow('Tool argument timeZone must be a string');
    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-02-30T09:00:00',
        end: '2026-02-30T10:00:00',
        timeZone: 'Europe/Warsaw',
      })
    ).rejects.toThrow('Tool argument start must be a valid ISO date-time string');
    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-08-18T14:30:00',
        end: '2026-08-18T15:15:00',
        timeZone: 'Invalid/Zone',
      })
    ).rejects.toThrow('Tool argument timeZone must be a valid IANA time zone');
    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-08-18T14:30:00',
        end: '2026-08-18T15:15:00',
        timeZone: '   ',
      })
    ).rejects.toThrow('Tool argument timeZone must be a valid IANA time zone');
    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-08-18T14:30:00',
        end: '2026-08-18T15:15:00',
      })
    ).rejects.toThrow('Tool argument start without an offset requires timeZone');
    await expect(
      calendarTool?.run({
        summary: 'DST gap',
        start: '2026-03-29T02:15:00',
        end: '2026-03-29T03:15:00',
        timeZone: 'Europe/Warsaw',
      })
    ).rejects.toThrow(
      'Tool argument start must resolve to exactly one instant in timeZone; include an explicit offset'
    );
    await expect(
      calendarTool?.run({
        summary: 'DST fold',
        start: '2026-10-25T02:15:00',
        end: '2026-10-25T04:15:00',
        timeZone: 'Europe/Warsaw',
      })
    ).rejects.toThrow(
      'Tool argument start must resolve to exactly one instant in timeZone; include an explicit offset'
    );
    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-08-18T15:15:00+02:00',
        end: '2026-08-18T14:30:00+02:00',
      })
    ).rejects.toThrow('Tool argument end must be after start');
    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start: '2026-08-18T14:30:00+02:00',
        end: '2026-08-18T15:15:00',
        timeZone: 'Europe/Warsaw',
      })
    ).rejects.toThrow(
      'Tool arguments start and end must both include offsets or both use timeZone'
    );
    await expect(
      codeTaskTool?.run({ prompt: 'Implement this', taskMode: 'fast' })
    ).rejects.toThrow('Tool argument taskMode must be one of: planning, execution');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'save_external')
        ?.run({ message: 123 })
    ).rejects.toThrow('Tool argument message must be a string');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'save_external')
        ?.run({ message: 'ok', sourceUrl: 123 })
    ).rejects.toThrow('Tool argument sourceUrl must be a string');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'add_user_preference')
        ?.run({ text: 'ok', expectedVersion: -1 })
    ).rejects.toThrow('Tool argument expectedVersion must be a non-negative integer');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'update_user_preference')
        ?.run({ itemId: 123, text: 'ok', expectedVersion: 0 })
    ).rejects.toThrow('Tool argument itemId must be a string');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'query_calendar_events')
        ?.run({
          mode: 'latest',
          timeMin: '2026-05-01T00:00:00.000Z',
          timeMax: '2026-06-01T00:00:00.000Z',
        })
    ).rejects.toThrow('Tool argument mode must be one of: list, count');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'query_calendar_events')
        ?.run({
          mode: 'list',
          timeMin: '2026-05-01T00:00:00.000Z',
          timeMax: '2026-06-01T00:00:00.000Z',
          maxResults: 0,
        })
    ).rejects.toThrow('Tool argument maxResults must be a positive integer');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'query_calendar_events')
        ?.run({
          mode: 'list',
          timeMin: 'tomorrow',
          timeMax: '2026-06-01T00:00:00.000Z',
        })
    ).rejects.toThrow('Tool argument timeMin must be an ISO date-time string');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'query_calendar_events')
        ?.run({
          mode: 'list',
          timeMin: '2026-05-01T00:00:00',
          timeMax: '2026-06-01T00:00:00.000Z',
        })
    ).rejects.toThrow('Tool argument timeMin must be an ISO date-time string');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'query_calendar_events')
        ?.run({
          mode: 'list',
          timeMin: '2026-02-31T00:00:00Z',
          timeMax: '2026-06-01T00:00:00.000Z',
        })
    ).rejects.toThrow('Tool argument timeMin must be an ISO date-time string');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'query_calendar_events')
        ?.run({
          mode: 'list',
          timeMin: '2026-01-01T24:00:00Z',
          timeMax: '2026-06-01T00:00:00.000Z',
        })
    ).rejects.toThrow('Tool argument timeMin must be an ISO date-time string');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'query_calendar_events')
        ?.run({
          mode: 'list',
          timeMin: '2026-06-01T00:00:00.000Z',
          timeMax: '2026-05-01T00:00:00.000Z',
        })
    ).rejects.toThrow('Tool argument timeMax must be after timeMin');
    await expect(
      createIntexAgentToolDefinitions(createExecutor())
        .find((tool) => tool.name === 'query_calendar_events')
        ?.run({
          mode: 'list',
          timeMin: '2026-05-01T00:00:00.000Z',
          timeMax: '2026-06-01T00:00:00.000Z',
          maxResults: 2501,
        })
    ).rejects.toThrow('Tool argument maxResults must be a positive integer');
  });

  it.each([
    ['zero month', '2026-00-18T14:30:00+02:00'],
    ['month above twelve', '2026-13-18T14:30:00+02:00'],
    ['zero day', '2026-08-00T14:30:00+02:00'],
    ['hour above twenty-three', '2026-08-18T24:30:00+02:00'],
    ['minute above fifty-nine', '2026-08-18T14:60:00+02:00'],
    ['second above fifty-nine', '2026-08-18T14:30:60+02:00'],
    ['offset hour above twenty-three', '2026-08-18T14:30:00+24:00'],
    ['offset minute above fifty-nine', '2026-08-18T14:30:00+02:60'],
  ])('rejects a calendar start with %s', async (_label, start) => {
    const calendarTool = createIntexAgentToolDefinitions(createExecutor()).find(
      (tool) => tool.name === 'create_calendar_event'
    );

    await expect(
      calendarTool?.run({
        summary: 'Dentist',
        start,
        end: '2026-08-18T15:15:00+02:00',
      })
    ).rejects.toThrow('Tool argument start must be a valid ISO date-time string');
  });
});

function createExecutor(): IntexAgentToolExecutor & {
  noteArgs: unknown[];
  calendarArgs: unknown[];
  calendarQueryArgs: unknown[];
  calendarUpdateArgs: unknown[];
  researchArgs: unknown[];
  linkArgs: unknown[];
  codeTaskArgs: unknown[];
  externalSaveArgs: unknown[];
  preferenceReadCalls: number;
  preferenceAddArgs: unknown[];
  preferenceUpdateArgs: unknown[];
  preferenceDeleteArgs: unknown[];
} {
  return {
    noteArgs: [],
    calendarArgs: [],
    calendarQueryArgs: [],
    calendarUpdateArgs: [],
    researchArgs: [],
    linkArgs: [],
    codeTaskArgs: [],
    externalSaveArgs: [],
    preferenceReadCalls: 0,
    preferenceAddArgs: [],
    preferenceUpdateArgs: [],
    preferenceDeleteArgs: [],
    createNote(args): Promise<string> {
      this.noteArgs.push(args);
      return Promise.resolve('note-created');
    },
    createCalendarEvent(args): Promise<string> {
      this.calendarArgs.push(args);
      return Promise.resolve('calendar-created');
    },
    queryCalendarEvents(args): Promise<string> {
      this.calendarQueryArgs.push(args);
      return Promise.resolve('calendar-query-completed');
    },
    updateCalendarEvent(args): Promise<string> {
      this.calendarUpdateArgs.push(args);
      return Promise.resolve('calendar-updated');
    },
    createResearch(args): Promise<string> {
      this.researchArgs.push(args);
      return Promise.resolve('research-created');
    },
    createLink(args): Promise<string> {
      this.linkArgs.push(args);
      return Promise.resolve('link-created');
    },
    createCodeTask(args): Promise<string> {
      this.codeTaskArgs.push(args);
      return Promise.resolve('code-task-created');
    },
    saveExternal(args): Promise<string> {
      this.externalSaveArgs.push(args);
      return Promise.resolve('external-saved');
    },
    getUserPreferences(): Promise<string> {
      this.preferenceReadCalls += 1;
      return Promise.resolve('preferences-read');
    },
    addUserPreference(args): Promise<string> {
      this.preferenceAddArgs.push(args);
      return Promise.resolve('preference-added');
    },
    updateUserPreference(args): Promise<string> {
      this.preferenceUpdateArgs.push(args);
      return Promise.resolve('preference-updated');
    },
    deleteUserPreference(args): Promise<string> {
      this.preferenceDeleteArgs.push(args);
      return Promise.resolve('preference-deleted');
    },
  };
}
