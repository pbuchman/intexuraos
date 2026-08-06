import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createIntexAgentRunner } from '../../domain/agent/intexAgentRunner.js';
import {
  createCapturedReplyPublisher,
  createTestToolExecutor,
} from '../../domain/testConversation/testToolMocks.js';
import { sanitizeAssistantReplies } from '../../domain/testConversation/testConversationSanitizer.js';
import type {
  CapturedAssistantReply,
  CapturedToolCall,
} from '../../domain/testConversation/testConversationTypes.js';
import { TEST_CONVERSATION_TOOL_FAILURE_CODE } from '../../domain/testConversation/testConversationTypes.js';

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
      maxResults: 10,
      query: 'private search INTEX-EVAL-011-F01',
      calendarId: 'private-calendar-id',
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
          maxResults: 10,
          queryLength: 33,
          hasCalendarId: true,
          syntheticMarkerCount: 1,
          syntheticMarkerDigest: markerDigest(['INTEX-EVAL-011-F01']),
        },
        resultSummary: { status: 'completed', mode: 'list', count: 0 },
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/private search|private-calendar-id|INTEX-EVAL/iu);
  });

  it('throws and records only the closed failure code for configured failures', async () => {
    const calls: CapturedToolCall[] = [];
    const privateFailure =
      'delivery failed for private.person@example.com; secret=sk-private-value';
    const executor = createTestToolExecutor({
      calls,
      mocks: {
        create_note: { mode: 'failure', message: privateFailure },
      },
    });

    await expect(executor.createNote({ content: 'secret note body' })).rejects.toThrow(
      TEST_CONVERSATION_TOOL_FAILURE_CODE
    );
    expect(calls).toEqual([
      {
        toolName: 'create_note',
        status: 'failed',
        argsSummary: {
          contentLength: 16,
          syntheticMarkerCount: 0,
          syntheticMarkerDigest: markerDigest([]),
        },
        error: TEST_CONVERSATION_TOOL_FAILURE_CODE,
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/private\.person@example\.com|sk-private-value/iu);
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
      syntheticMarkerCount: 0,
      syntheticMarkerDigest: markerDigest([]),
    });
    expect(JSON.stringify(calls)).not.toContain('private');
    expect(JSON.stringify(calls)).not.toContain('wamid-1');
  });

  it('records canonical marker evidence without changing it when surrounding secrets change', async () => {
    const calls: CapturedToolCall[] = [];
    const executor = createTestToolExecutor({ calls });

    await executor.createNote({
      content: 'private-one INTEX-EVAL-006-F01 INTEX-EVAL-006',
    });
    await executor.createNote({
      content: 'private-two INTEX-EVAL-006 INTEX-EVAL-006-F01',
    });

    const expectedEvidence = {
      syntheticMarkerCount: 2,
      syntheticMarkerDigest: markerDigest(['INTEX-EVAL-006', 'INTEX-EVAL-006-F01']),
    };
    expect(calls[0]?.argsSummary).toMatchObject(expectedEvidence);
    expect(calls[1]?.argsSummary).toMatchObject(expectedEvidence);
    expect(JSON.stringify(calls)).not.toMatch(/private-one|private-two|INTEX-EVAL/iu);
  });

  it('returns canonical default preference blocks that sanitize to resulting-state replies', async () => {
    const calls: CapturedToolCall[] = [];
    const executor = createTestToolExecutor({ calls });

    const add = JSON.parse(
      await executor.addUserPreference({ text: '  Reply   briefly.  ', expectedVersion: 0 })
    ) as Record<string, unknown>;
    const update = JSON.parse(
      await executor.updateUserPreference({
        itemId: 'pref_input',
        text: 'Reply formally.',
        expectedVersion: 1,
      })
    ) as Record<string, unknown>;
    const deleted = JSON.parse(
      await executor.deleteUserPreference({ itemId: 'pref_input', expectedVersion: 2 })
    ) as Record<string, unknown>;

    expect(add['promptBlock']).toBe(
      'User Preferences v1:\n1. (id: pref_mock) "Reply briefly."'
    );
    expect(update['promptBlock']).toBe(
      'User Preferences v2:\n1. (id: pref_input) "Reply formally."'
    );
    expect(deleted['promptBlock']).toBe('');
  });

  it('returns friendly sanitized replies for preference mutations', async () => {
    const calls: CapturedToolCall[] = [];
    const runner = createIntexAgentRunner({
      client: {} as Parameters<typeof createIntexAgentRunner>[0]['client'],
      toolExecutor: createTestToolExecutor({ calls }),
    });
    const session = {
      id: 'intex_session_test',
      userId: 'test-intex-agent-preference-replies',
      channel: 'whatsapp' as const,
      status: 'waiting_for_user' as const,
      startedAt: '2026-07-16T10:00:00.000Z',
      lastUserMessageAt: '2026-07-16T10:00:00.000Z',
      startReason: 'no_active_session' as const,
    };
    const results = await Promise.all([
      runner.executeConfirmed({
        session,
        toolName: 'add_user_preference',
        toolArgs: { text: 'Reply briefly.', expectedVersion: 0 },
        currentDateTime: '2026-07-16T10:00:00.000Z',
      }),
      runner.executeConfirmed({
        session,
        toolName: 'update_user_preference',
        toolArgs: { itemId: 'pref_input', text: 'Reply formally.', expectedVersion: 1 },
        currentDateTime: '2026-07-16T10:00:00.000Z',
      }),
      runner.executeConfirmed({
        session,
        toolName: 'delete_user_preference',
        toolArgs: { itemId: 'pref_input', expectedVersion: 2 },
        currentDateTime: '2026-07-16T10:00:00.000Z',
      }),
    ]);
    const sanitizedReplies = sanitizeAssistantReplies(
      results.map((result, index) => ({
        userId: session.userId,
        message: result.reply,
        replyToMessageId: `wamid-${String(index)}`,
        correlationId: session.id,
      }))
    );

    expect(sanitizedReplies.map((reply) => reply.message)).toEqual([
      'Updated the instruction memory.',
      'Updated the instruction memory.',
      'Updated the instruction memory.',
    ]);
    expect(calls.map((call) => call.toolName)).toEqual([
      'add_user_preference',
      'update_user_preference',
      'delete_user_preference',
    ]);
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
        await executor.createCodeTask({ prompt: 'Fix the prompt', taskMode: 'planning' }),
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

function markerDigest(markers: readonly string[]): string {
  return createHash('sha256')
    .update(`intex-eval-marker-set:v1\0${[...markers].sort().join('\n')}`, 'utf8')
    .digest('hex');
}
