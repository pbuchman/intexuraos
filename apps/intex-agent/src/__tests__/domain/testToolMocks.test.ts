import { describe, expect, it } from 'vitest';
import {
  createCapturedReplyPublisher,
  createTestToolExecutor,
} from '../../domain/testConversation/testToolMocks.js';
import type {
  CapturedAssistantReply,
  CapturedToolCall,
} from '../../domain/testConversation/testConversationTypes.js';

type TestToolExecutor = ReturnType<typeof createTestToolExecutor>;
type TestToolRunner = (executor: TestToolExecutor) => Promise<string>;

describe('test tool mocks', () => {
  it('returns configured successful tool JSON and records a sanitized call summary', async () => {
    const calls: CapturedToolCall[] = [];
    const executor = createTestToolExecutor({
      calls,
      mocks: {
        query_calendar_events: {
          mode: 'success',
          result: { status: 'completed', mode: 'list', count: 0, events: [] },
        },
      },
    });

    const raw = await executor.queryCalendarEvents({
      mode: 'list',
      timeMin: '2026-07-02T00:00:00+02:00',
      timeMax: '2026-07-03T00:00:00+02:00',
    });

    expect(JSON.parse(raw)).toEqual({ status: 'completed', mode: 'list', count: 0, events: [] });
    expect(calls).toEqual([
      {
        toolName: 'query_calendar_events',
        status: 'completed',
        argsSummary: {
          mode: 'list',
          timeMin: '2026-07-02T00:00:00+02:00',
          timeMax: '2026-07-03T00:00:00+02:00',
        },
        resultSummary: { status: 'completed', mode: 'list', count: 0 },
      },
    ]);
  });

  it('throws configured failures and records the error without raw args', async () => {
    const calls: CapturedToolCall[] = [];
    const executor = createTestToolExecutor({
      calls,
      mocks: {
        create_note: { mode: 'failure', message: 'mock note failure' },
      },
    });

    await expect(executor.createNote({ content: 'secret note body' })).rejects.toThrow(
      'mock note failure'
    );
    expect(calls).toEqual([
      {
        toolName: 'create_note',
        status: 'failed',
        argsSummary: { contentLength: 16 },
        error: 'mock note failure',
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain('secret note body');
  });

  it('summarizes array arguments by count only', async () => {
    const calls: CapturedToolCall[] = [];
    const executor = createTestToolExecutor({ calls });

    await executor.createNote({
      content: 'secret note body',
      tags: ['private', 'work'],
      sourceMessageIds: ['wamid-1'],
    });

    expect(calls[0]?.argsSummary).toEqual({
      contentLength: 16,
      tagsCount: 2,
      sourceMessageIdsCount: 1,
    });
    expect(JSON.stringify(calls)).not.toContain('private');
    expect(JSON.stringify(calls)).not.toContain('wamid-1');
  });

  it('redacts raw URLs, prompts, and preference text from captured tool summaries', async () => {
    const calls: CapturedToolCall[] = [];
    const executor = createTestToolExecutor({
      calls,
      mocks: {
        create_code_task: {
          mode: 'success',
          result: {
            status: 'completed',
            codeTaskId: 'task_mock',
            resourceUrl: 'https://example.com/private/task',
            promptBlock: 'never expose this',
          },
        },
      },
    });

    await executor.createCodeTask({
      prompt: 'Fix secret prompt text',
      linearIssueId: 'INT-1234',
      taskMode: 'execution',
    });
    await executor.addUserPreference({ text: 'Always answer with private phrase', expectedVersion: 3 });

    expect(calls).toMatchObject([
      {
        toolName: 'create_code_task',
        argsSummary: {
          promptLength: 22,
          taskMode: 'execution',
          hasLinearIssueId: true,
        },
        resultSummary: {
          status: 'completed',
          hasCodeTaskId: true,
        },
      },
      {
        toolName: 'add_user_preference',
        argsSummary: {
          textLength: 33,
          expectedVersion: 3,
        },
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain('Fix secret prompt text');
    expect(JSON.stringify(calls)).not.toContain('private phrase');
    expect(JSON.stringify(calls)).not.toContain('https://example.com/private/task');
    expect(JSON.stringify(calls)).not.toContain('never expose this');
  });

  it.each([
    [
      'create_note',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.createNote({ content: 'x' }),
    ],
    [
      'create_calendar_event',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.createCalendarEvent({
          summary: 'Dentist',
          start: '2026-08-18T14:30:00+02:00',
          end: '2026-08-18T15:15:00+02:00',
        }),
    ],
    [
      'query_calendar_events',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.queryCalendarEvents({
          mode: 'count',
          timeMin: '2026-08-18T00:00:00+02:00',
          timeMax: '2026-08-19T00:00:00+02:00',
        }),
    ],
    [
      'create_research',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.createResearch({ title: 'GPU', prompt: 'Research GPU pricing' }),
    ],
    [
      'create_link',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.createLink({ url: 'https://example.com' }),
    ],
    [
      'create_code_task',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.createCodeTask({ prompt: 'Fix the prompt' }),
    ],
    [
      'save_external',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.saveExternal({ message: 'receipt' }),
    ],
    [
      'get_user_preferences',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.getUserPreferences(),
    ],
    [
      'add_user_preference',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.addUserPreference({ text: 'Reply briefly', expectedVersion: 0 }),
    ],
    [
      'update_user_preference',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.updateUserPreference({
          itemId: 'pref_1',
          text: 'Reply in Polish',
          expectedVersion: 1,
        }),
    ],
    [
      'delete_user_preference',
      async (executor: TestToolExecutor): Promise<string> =>
        await executor.deleteUserPreference({ itemId: 'pref_1', expectedVersion: 2 }),
    ],
  ] satisfies readonly (readonly [string, TestToolRunner])[])(
    'returns a default success result for %s',
    async (toolName, runTool) => {
    const calls: CapturedToolCall[] = [];
    const executor = createTestToolExecutor({ calls });

    const raw = await runTool(executor);

    expect(JSON.parse(raw)).toMatchObject({ status: 'completed' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.toolName).toBe(toolName);
    expect(calls[0]?.status).toBe('completed');
    }
  );

  it('captures WhatsApp replies including ctas and buttons', async () => {
    const replies: CapturedAssistantReply[] = [];
    const publisher = createCapturedReplyPublisher(replies);

    await publisher.publishReply({
      userId: 'test-intex-agent-run',
      message: 'Saved the note.',
      replyToMessageId: 'wamid-1',
      correlationId: 'intex_session_1',
      ctaUrl: { displayText: 'Open note', url: 'https://example.com/notes/1' },
      buttons: [{ type: 'reply', reply: { id: 'intex_confirm:abc:yes', title: 'Yes' } }],
    });

    expect(replies).toEqual([
      {
        userId: 'test-intex-agent-run',
        message: 'Saved the note.',
        replyToMessageId: 'wamid-1',
        correlationId: 'intex_session_1',
        ctaUrl: { displayText: 'Open note', url: 'https://example.com/notes/1' },
        buttons: [{ type: 'reply', reply: { id: 'intex_confirm:abc:yes', title: 'Yes' } }],
      },
    ]);
  });
});
