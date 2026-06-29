import { describe, expect, it } from 'vitest';
import {
  createIntexAgentToolDefinitions,
  type IntexAgentToolExecutor,
} from '../../domain/agent/toolDefinitions.js';

describe('createIntexAgentToolDefinitions', () => {
  it('defines exactly the supported tools', () => {
    const tools = createIntexAgentToolDefinitions(createExecutor());

    expect(tools.map((tool) => tool.name)).toEqual([
      'create_note',
      'create_calendar_event',
      'query_calendar_events',
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
    expect(calendarTool?.description).toContain('Ask a clarification before calling this tool');
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
    expect(calendarQueryTool?.parameters['required']).toEqual(['mode', 'timeMin', 'timeMax']);
    expect(calendarQueryTool?.parameters['properties']).toMatchObject({
      maxResults: {
        type: 'integer',
        minimum: 1,
        maximum: 2500,
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
        enum: ['codex', 'codex-xhigh', 'minimax'],
        description: expect.stringMatching(
          /only when explicitly requested.*Codex.*codex.*Codex extra high.*codex-xhigh.*MiniMax.*minimax/
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

  it('omits code task mode by default so the executor can create planning tasks', async () => {
    const executor = createExecutor();
    const codeTaskTool = createIntexAgentToolDefinitions(executor).find(
      (tool) => tool.name === 'create_code_task'
    );

    await expect(codeTaskTool?.run({ prompt: 'Plan the new import flow.' })).resolves.toBe(
      'code-task-created'
    );
    expect(executor.codeTaskArgs).toEqual([{ prompt: 'Plan the new import flow.' }]);
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
});

function createExecutor(): IntexAgentToolExecutor & {
  noteArgs: unknown[];
  calendarArgs: unknown[];
  calendarQueryArgs: unknown[];
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
