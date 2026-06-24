import { describe, expect, it } from 'vitest';
import {
  createIntexAgentToolDefinitions,
  type IntexAgentToolExecutor,
} from '../../domain/agent/toolDefinitions.js';

describe('createIntexAgentToolDefinitions', () => {
  it('defines exactly the supported tools', () => {
    const tools = createIntexAgentToolDefinitions(createExecutor());

    expect(tools.map((tool) => tool.name)).toEqual(['create_note', 'create_calendar_event']);
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

  it('does not expose unsupported work as a tool', () => {
    const toolNames = createIntexAgentToolDefinitions(createExecutor()).map((tool) => tool.name);

    expect(toolNames).not.toContain('book_uber');
    expect(toolNames).not.toContain('create_reminder');
    expect(toolNames).not.toContain('research');
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

  it('rejects invalid required and optional tool arguments', async () => {
    const [noteTool, calendarTool] = createIntexAgentToolDefinitions(createExecutor());

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
  });
});

function createExecutor(): IntexAgentToolExecutor & {
  noteArgs: unknown[];
  calendarArgs: unknown[];
} {
  return {
    noteArgs: [],
    calendarArgs: [],
    createNote(args): Promise<string> {
      this.noteArgs.push(args);
      return Promise.resolve('note-created');
    },
    createCalendarEvent(args): Promise<string> {
      this.calendarArgs.push(args);
      return Promise.resolve('calendar-created');
    },
  };
}
