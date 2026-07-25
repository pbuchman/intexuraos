import { beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import type { Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import { createOpenRouterToolCallingClient } from '../toolCallingClient.js';

const API_BASE_URL = 'https://openrouter.ai/api/v1';
const TEST_MODEL = 'google/gemini-3-flash-preview';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const { mockUsageLoggerLog } = vi.hoisted(() => ({
  mockUsageLoggerLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@intexuraos/llm-pricing', async (): Promise<typeof import('@intexuraos/llm-pricing')> => {
  const actual =
    await vi.importActual<typeof import('@intexuraos/llm-pricing')>('@intexuraos/llm-pricing');
  return {
    ...actual,
    createUsageLogger: vi.fn().mockReturnValue({
      log: mockUsageLoggerLog,
    }),
  } as typeof import('@intexuraos/llm-pricing');
});

function createClient(): ReturnType<typeof createOpenRouterToolCallingClient> {
  return createOpenRouterToolCallingClient({
    apiKey: 'test-key',
    model: TEST_MODEL,
    userId: 'user-123',
    logger: mockLogger,
    usageSink: new FakeUsageSink(),
  });
}

function createClientWithConfig(
  overrides: Partial<Parameters<typeof createOpenRouterToolCallingClient>[0]>
): ReturnType<typeof createOpenRouterToolCallingClient> {
  return createOpenRouterToolCallingClient({
    apiKey: 'test-key',
    model: TEST_MODEL,
    userId: 'user-123',
    logger: mockLogger,
    usageSink: new FakeUsageSink(),
    ...overrides,
  });
}

describe('createOpenRouterToolCallingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
  });

  it('returns a text response and logs usage with promptType when no tool is called', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    nock(API_BASE_URL)
      .post('/chat/completions', (body) => {
        capturedBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, {
        id: 'chatcmpl-1',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'No review needed.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cost: 0.00012 },
      });

    const result = await createClient().run({
      systemPrompt: 'You are a PR triage agent.',
      messages: [{ role: 'user', content: 'Evaluate PR 42.' }],
      tools: [],
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('No review needed.');
    expect(result.value.toolCallsMade).toBe(0);
    expect(result.value.usage.inputTokens).toBe(11);
    expect(result.value.usage.costUsd).toBe(0.00012);
    expect(result.value.usage.providerReportedUsd).toBe(0.00012);
    expect(capturedBody?.['model']).toBe(TEST_MODEL);
    expect(capturedBody?.['messages']).toEqual([
      { role: 'system', content: 'You are a PR triage agent.' },
      { role: 'user', content: 'Evaluate PR 42.' },
    ]);
    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openrouter',
        model: TEST_MODEL,
        callType: 'tool_calling',
        promptType: 'github-agent-pr-triage',
        providerReportedUsd: 0.00012,
      })
    );
  });

  it('preserves an explicitly reported zero provider cost', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [{ message: { role: 'assistant', content: 'Done.' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cost: 0 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage.providerReportedUsd).toBe(0);
    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({ providerReportedUsd: 0 })
    );
  });

  it('returns one exact Matrix usage record per provider iteration', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'note', arguments: '{}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.0001 },
      })
      .post('/chat/completions')
      .reply(200, {
        choices: [{ message: { role: 'assistant', content: 'Done.' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, cost: 0.0002 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'note',
          description: 'Note.',
          parameters: { type: 'object' },
          run: vi.fn().mockResolvedValue('{}'),
        },
      ],
      matrixCorpusContext: {
        version: 1,
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_1',
        turnIndex: 0,
        stage: 'agent_generation',
        callOrdinal: 1,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providerCalls).toEqual([
      {
        context: expect.objectContaining({ stage: 'agent_generation', callOrdinal: 1 }),
        modelId: TEST_MODEL,
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        providerReportedUsd: 0.0001,
      },
      {
        context: expect.objectContaining({ stage: 'agent_generation', callOrdinal: 2 }),
        modelId: TEST_MODEL,
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
        providerReportedUsd: 0.0002,
      },
    ]);
  });

  it('stops after a terminal tool callback without asking the model to call it again', async () => {
    const terminalRun = vi.fn().mockResolvedValue('{"status":"needs_confirmation"}');
    const laterRun = vi.fn().mockResolvedValue('{}');
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_terminal',
                  type: 'function',
                  function: { name: 'create_note', arguments: '{"content":"Door code"}' },
                },
                {
                  id: 'call_later',
                  type: 'function',
                  function: { name: 'save_external', arguments: '{}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.0001 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'save a note' }],
      tools: [
        {
          name: 'create_note',
          description: 'Create note preview.',
          parameters: { type: 'object' },
          stopAfterRun: true,
          run: terminalRun,
        },
        {
          name: 'save_external',
          description: 'Save externally.',
          parameters: { type: 'object' },
          run: laterRun,
        },
      ],
      matrixCorpusContext: {
        version: 1,
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_1',
        turnIndex: 0,
        stage: 'agent_generation',
        callOrdinal: 1,
      },
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        content: '',
        toolCallsMade: 1,
        iterationCount: 1,
        providerCalls: [
          expect.objectContaining({ context: expect.objectContaining({ callOrdinal: 1 }) }),
        ],
      }),
    });
    expect(terminalRun).toHaveBeenCalledTimes(1);
    expect(laterRun).not.toHaveBeenCalled();
    expect(nock.isDone()).toBe(true);
  });

  it('returns terminal assistant content without Matrix corpus evidence', async () => {
    const terminalRun = vi.fn().mockResolvedValue('preview ready');
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'I prepared the note preview.',
              tool_calls: [
                {
                  id: 'call_terminal',
                  type: 'function',
                  function: { name: 'create_note', arguments: '{"content":"Door code"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.0001 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'save a note' }],
      tools: [
        {
          name: 'create_note',
          description: 'Create note preview.',
          parameters: { type: 'object' },
          stopAfterRun: true,
          run: terminalRun,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        content: 'I prepared the note preview.',
        toolCallsMade: 1,
        iterationCount: 1,
      }),
    });
    expect(result).toEqual({
      ok: true,
      value: expect.not.objectContaining({ providerCalls: expect.anything() }),
    });
    expect(terminalRun).toHaveBeenCalledTimes(1);
    expect(nock.isDone()).toBe(true);
  });

  it('never logs or sends to Sentry Matrix tool arguments, results, or thrown errors', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_private',
                  type: 'function',
                  function: {
                    name: 'note',
                    arguments: JSON.stringify({ content: 'PRIVATE_ARGUMENT_SENTINEL' }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.0001 },
      })
      .post('/chat/completions')
      .reply(200, {
        choices: [{ message: { content: 'Done.' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.0001 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'note',
          description: 'Note.',
          parameters: { type: 'object' },
          stopAfterRun: true,
          run: vi.fn(async () => {
            throw new Error('PRIVATE_THROWN_ERROR_SENTINEL');
          }),
        },
      ],
      matrixCorpusContext: {
        version: 1,
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_1',
        turnIndex: 0,
        stage: 'agent_generation',
        callOrdinal: 1,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        content: 'Done.',
        iterationCount: 2,
        providerCalls: [{ context: { callOrdinal: 1 } }, { context: { callOrdinal: 2 } }],
      },
    });
    expect(nock.isDone()).toBe(true);
    const logs = JSON.stringify([
      vi.mocked(mockLogger.info).mock.calls,
      vi.mocked(mockLogger.warn).mock.calls,
      vi.mocked(mockLogger.error).mock.calls,
    ]);
    expect(logs).not.toMatch(/PRIVATE_ARGUMENT_SENTINEL|PRIVATE_THROWN_ERROR_SENTINEL/u);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'TOOL_CALLBACK_REJECTED', _skipSentry: true }),
      expect.any(String)
    );
  });

  it('persists completed Matrix usage before a later provider failure without exposing its error', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'note', arguments: '{}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.0001 },
      })
      .post('/chat/completions')
      .reply(500, 'PRIVATE_PROVIDER_ERROR_SENTINEL');
    const onProviderCall = vi.fn().mockResolvedValue(undefined);

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'note',
          description: 'Note.',
          parameters: { type: 'object' },
          run: vi.fn().mockResolvedValue('{}'),
        },
      ],
      matrixCorpusContext: {
        version: 1,
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_1',
        turnIndex: 0,
        stage: 'agent_generation',
        callOrdinal: 1,
      },
      onMatrixCorpusProviderCall: onProviderCall,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'OVERLOADED', message: 'Matrix provider call failed' },
    });
    expect(onProviderCall).toHaveBeenCalledTimes(1);
    expect(onProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 10, outputTokens: 2, totalTokens: 12 })
    );
    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: 'MATRIX_PROVIDER_CALL_FAILED' })
    );
    expect(
      JSON.stringify([
        result,
        vi.mocked(mockLogger.info).mock.calls,
        vi.mocked(mockLogger.warn).mock.calls,
        vi.mocked(mockLogger.error).mock.calls,
        mockUsageLoggerLog.mock.calls,
      ])
    ).not.toContain('PRIVATE_PROVIDER_ERROR_SENTINEL');
  });

  it('does not log a hallucinated Matrix tool name', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'PRIVATE_TOOL_NAME_SENTINEL', arguments: '{}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 },
      })
      .post('/chat/completions')
      .reply(200, {
        choices: [{ message: { role: 'assistant', content: 'Recovered.' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 },
      });

    await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      matrixCorpusContext: {
        version: 1,
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_1',
        turnIndex: 0,
        stage: 'agent_generation',
        callOrdinal: 1,
      },
    });

    const logs = JSON.stringify([
      vi.mocked(mockLogger.info).mock.calls,
      vi.mocked(mockLogger.warn).mock.calls,
      vi.mocked(mockLogger.error).mock.calls,
    ]);
    expect(logs).not.toContain('PRIVATE_TOOL_NAME_SENTINEL');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'UNKNOWN_TOOL_SELECTION', _skipSentry: true }),
      'OpenRouter tool calling: hallucinated tool name'
    );
  });

  it('retries required tool choice when the provider returns final text without a tool call', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const runTool = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ status: 'completed', currentVersion: 1, promptBlock: '' })
      );
    nock(API_BASE_URL)
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        id: 'chatcmpl-required-without-tool',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({ outcome: 'no_action', reply: 'No action needed.' }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cost: 0.00012 },
      })
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_required_retry',
                  type: 'function',
                  function: {
                    name: 'add_user_preference',
                    arguments: JSON.stringify({ text: 'Be concise.', expectedVersion: 0 }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18, cost: 0.00013 },
      })
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                outcome: 'completed',
                reply: 'Preference prepared.',
                toolName: 'add_user_preference',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 15, completion_tokens: 6, total_tokens: 21, cost: 0.00014 },
      });

    const result = await createClient().run({
      systemPrompt: 'Use the preference tool for explicit durable additions.',
      messages: [{ role: 'user', content: 'Add this durable preference.' }],
      tools: [
        {
          name: 'add_user_preference',
          description: 'Add a durable user preference.',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              expectedVersion: { type: 'number' },
            },
            required: ['text', 'expectedVersion'],
          },
          run: runTool,
        },
      ],
      toolChoice: 'required',
      promptType: 'intex-agent-runner',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      toolCallsMade: 1,
      iterationCount: 3,
    });
    expect(capturedBodies[0]?.['tool_choice']).toEqual({
      type: 'function',
      function: { name: 'add_user_preference' },
    });
    expect(capturedBodies[1]?.['tool_choice']).toEqual({
      type: 'function',
      function: { name: 'add_user_preference' },
    });
    expect(capturedBodies[2]?.['tool_choice']).toBe('auto');
    expect(capturedBodies[1]?.['messages']).toEqual(
      expect.arrayContaining([
        {
          role: 'assistant',
          content: JSON.stringify({ outcome: 'no_action', reply: 'No action needed.' }),
        },
        {
          role: 'user',
          content: expect.stringContaining('Call one of the provided tools'),
        },
      ])
    );
    expect(runTool).toHaveBeenCalledWith({ text: 'Be concise.', expectedVersion: 0 });
  });

  it('logs ownerType and zero usage when OpenRouter omits usage metadata', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        id: 'chatcmpl-no-usage',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Done.' },
            finish_reason: 'stop',
          },
        ],
      });

    const result = await createClientWithConfig({ ownerType: 'user' }).run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    });
    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'user',
        usage: expect.objectContaining({ inputTokens: 0 }),
      })
    );
  });

  it('executes OpenAI-compatible tool calls and returns the final response', async () => {
    const runTool = vi.fn().mockResolvedValue(JSON.stringify({ recorded: true }));
    const capturedBodies: Record<string, unknown>[] = [];
    nock(API_BASE_URL)
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        id: 'chatcmpl-2',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'request_review',
                    arguments: '{"review_type":"code_quality"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, cost: 0.0002 },
      })
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        id: 'chatcmpl-3',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Review queued.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 35, completion_tokens: 8, total_tokens: 43, cost: 0.0003 },
      });

    const result = await createClient().run({
      systemPrompt: 'You are a PR triage agent.',
      messages: [{ role: 'user', content: 'Evaluate PR 42.' }],
      tools: [
        {
          name: 'request_review',
          description: 'Request a review.',
          parameters: { type: 'object', properties: { review_type: { type: 'string' } } },
          run: runTool,
        },
      ],
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(runTool).toHaveBeenCalledWith({ review_type: 'code_quality' });
    expect(result.value.content).toBe('Review queued.');
    expect(result.value.toolCallsMade).toBe(1);
    expect(result.value.usage.inputTokens).toBe(55);
    expect(result.value.usage.outputTokens).toBe(13);
    expect(result.value.usage.costUsd).toBe(0.0005);
    expect(result.value.usage.providerReportedUsd).toBe(0.0005);
    expect(capturedBodies[0]?.['tools']).toEqual([
      {
        type: 'function',
        function: {
          name: 'request_review',
          description: 'Request a review.',
          parameters: { type: 'object', properties: { review_type: { type: 'string' } } },
        },
      },
    ]);
    expect(capturedBodies[0]?.['tool_choice']).toEqual({
      type: 'function',
      function: { name: 'request_review' },
    });
    expect(capturedBodies[1]?.['messages']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
        {
          role: 'tool',
          tool_call_id: 'call_1',
          name: 'request_review',
          content: JSON.stringify({ recorded: true }),
        },
      ])
    );
    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({
        promptType: 'github-agent-pr-triage',
        providerReportedUsd: 0.0005,
      })
    );
  });

  it('keeps generic required tool choice when multiple tools are available', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    nock(API_BASE_URL)
      .post('/chat/completions', (body) => {
        capturedBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_create_note',
                  type: 'function',
                  function: { name: 'create_note', arguments: '{"content":"test"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.0001 },
      });

    const result = await createClient().run({
      systemPrompt: 'Use one appropriate tool.',
      messages: [{ role: 'user', content: 'Store this.' }],
      tools: [
        {
          name: 'create_note',
          description: 'Create note.',
          parameters: { type: 'object', properties: { content: { type: 'string' } } },
          run: async (): Promise<string> => JSON.stringify({ status: 'completed' }),
          stopAfterRun: true,
        },
        {
          name: 'create_link',
          description: 'Create link.',
          parameters: { type: 'object', properties: { url: { type: 'string' } } },
          run: async (): Promise<string> => JSON.stringify({ status: 'completed' }),
          stopAfterRun: true,
        },
      ],
      toolChoice: 'required',
    });

    expect(result.ok).toBe(true);
    expect(capturedBody?.['tool_choice']).toBe('required');
  });

  it('uses auto tool choice when requested', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    nock(API_BASE_URL)
      .post('/chat/completions', (body) => {
        capturedBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, {
        choices: [
          {
            message: { role: 'assistant', content: '{"outcome":"no_action","reply":"Hi"}' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.0001 },
      });

    const result = await createClient().run({
      systemPrompt: 'Return JSON.',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          name: 'create_note',
          description: 'Create note.',
          parameters: { type: 'object', properties: { content: { type: 'string' } } },
          run: vi.fn(),
        },
      ],
      toolChoice: 'auto',
    });

    expect(result.ok).toBe(true);
    expect(capturedBody?.['tool_choice']).toBe('auto');
  });

  it('keeps aggregate provider cost unknown when any tool iteration omits it', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'note', arguments: '{}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.0001 },
      })
      .post('/chat/completions')
      .reply(200, {
        choices: [{ message: { role: 'assistant', content: 'Done.' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'note',
          description: 'Note.',
          parameters: { type: 'object' },
          run: vi.fn().mockResolvedValue('{}'),
        },
      ],
      matrixCorpusContext: {
        version: 1,
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'session_1',
        turnIndex: 0,
        stage: 'agent_generation',
        callOrdinal: 1,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage.costUsd).toBe(0);
    expect(result.value.usage).not.toHaveProperty('providerReportedUsd');
    expect(result.value.providerCalls?.[1]).not.toHaveProperty('providerReportedUsd');
    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.not.objectContaining({ providerReportedUsd: expect.anything() })
    );
  });

  it('keeps aggregate provider cost unknown when a priced tool call is followed by a failed request', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'note', arguments: '{}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.0001 },
      })
      .post('/chat/completions')
      .replyWithError(new Error('follow-up failed'));

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'note',
          description: 'Note.',
          parameters: { type: 'object' },
          run: vi.fn().mockResolvedValue('{}'),
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.not.objectContaining({ providerReportedUsd: expect.anything() })
    );
  });

  it('sends tool error responses for unknown tools and thrown callbacks', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    nock(API_BASE_URL)
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        id: 'chatcmpl-4',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_unknown',
                  type: 'function',
                  function: { name: 'missing_tool', arguments: '{}' },
                },
                {
                  id: 'call_throwing',
                  type: 'function',
                  function: { name: 'request_review', arguments: '{bad-json' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      })
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        id: 'chatcmpl-5',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Recovered.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'Run tools' }],
      tools: [
        {
          name: 'request_review',
          description: 'Throws.',
          parameters: { type: 'object' },
          run: async (): Promise<string> => {
            throw new Error('boom');
          },
        },
      ],
      promptType: 'github-agent-comment-triage',
    });

    expect(result.ok).toBe(true);
    const secondMessages = capturedBodies[1]?.['messages'] as Record<string, unknown>[];
    const toolMessages = secondMessages.filter((m) => m['role'] === 'tool');
    expect(toolMessages).toEqual([
      expect.objectContaining({
        tool_call_id: 'call_unknown',
        content: JSON.stringify({ error: 'Unknown tool: missing_tool' }),
      }),
      expect.objectContaining({
        tool_call_id: 'call_throwing',
        content: JSON.stringify({ error: 'boom' }),
      }),
    ]);

    // Sentry INTEXURAOS-HETZNER-3J: hallucinated tool name is a normal
    // self-correction signal; the warn must carry `_skipSentry` so the Pino
    // transport does not page on it.
    const hallucinationWarn = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      ([payload, msg]) =>
        msg === 'OpenRouter tool calling: hallucinated tool name' &&
        (payload as { toolName?: string } | undefined)?.toolName === 'missing_tool'
    );
    expect(hallucinationWarn).toBeDefined();
    expect(hallucinationWarn?.[0]).toMatchObject({ _skipSentry: true });
  });

  it('uses fallback tool call metadata when OpenRouter omits tool id and function', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        id: 'chatcmpl-fallback-tool',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{}],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      })
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        id: 'chatcmpl-fallback-final',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Recovered.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      promptType: 'github-agent-comment-triage',
    });

    expect(result.ok).toBe(true);
    const retryMessages = capturedBodies[0]?.['messages'] as Record<string, unknown>[];
    expect(retryMessages).toEqual(
      expect.arrayContaining([
        {
          role: 'tool',
          tool_call_id: 'call_1_0',
          name: '',
          content: JSON.stringify({ error: 'Unknown tool: ' }),
        },
      ])
    );
  });

  it('injects repair message when max iterations are exhausted', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    nock(API_BASE_URL)
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        id: 'chatcmpl-6',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'skip', arguments: '{"reason":"docs"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      })
      .post('/chat/completions', (body) => {
        capturedBodies.push(body as Record<string, unknown>);
        return true;
      })
      .reply(200, {
        id: 'chatcmpl-7',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Skipped after repair.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'Evaluate' }],
      tools: [
        {
          name: 'skip',
          description: 'Skip.',
          parameters: { type: 'object' },
          run: async (): Promise<string> => JSON.stringify({ skipped: true }),
        },
      ],
      maxIterations: 1,
      repairIterations: 1,
      onExhausted: () => 'Return a final answer now.',
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Skipped after repair.');
    expect(capturedBodies[1]?.['messages']).toEqual(
      expect.arrayContaining([{ role: 'user', content: 'Return a final answer now.' }])
    );
  });

  it('returns API_ERROR when max iterations are exhausted without repair', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        id: 'chatcmpl-max-no-repair',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'skip', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'skip',
          description: 'Skip.',
          parameters: { type: 'object' },
          run: async (): Promise<string> => JSON.stringify({ skipped: true }),
        },
      ],
      maxIterations: 1,
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'API_ERROR',
      message: 'Tool calling loop exceeded maxIterations',
    });
  });

  it('returns API_ERROR when max iterations are exhausted and repair is unavailable', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        id: 'chatcmpl-max-no-message',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'skip', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'skip',
          description: 'Skip.',
          parameters: { type: 'object' },
          run: async (): Promise<string> => JSON.stringify({ skipped: true }),
        },
      ],
      maxIterations: 1,
      onExhausted: () => undefined,
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
  });

  it('returns API_ERROR and logs failed usage when OpenRouter returns empty content', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        id: 'chatcmpl-8',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
      });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        promptType: 'github-agent-pr-triage',
        errorMessage: 'Empty response from model',
      })
    );
  });

  it('returns API_ERROR and logs failed usage when OpenRouter omits choices', async () => {
    nock(API_BASE_URL).post('/chat/completions').reply(200, {
      id: 'chatcmpl-empty-choices',
      model: TEST_MODEL,
      created: Date.now(),
      object: 'chat.completion',
      choices: [],
    });

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        promptType: 'github-agent-pr-triage',
        errorMessage: 'Empty response from model',
      })
    );
  });

  it.each([
    { status: 401, code: 'INVALID_KEY' },
    { status: 429, code: 'RATE_LIMITED' },
    { status: 400, code: 'API_ERROR' },
    { status: 503, code: 'OVERLOADED' },
    { status: 500, code: 'OVERLOADED' },
  ] as const)('maps HTTP $status to $code', async ({ status, code }) => {
    nock(API_BASE_URL).post('/chat/completions').reply(status, 'provider error');

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
  });

  it('maps malformed OpenRouter responses to API_ERROR', async () => {
    nock(API_BASE_URL).post('/chat/completions').reply(200, 'not-json');

    const result = await createClient().run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
  });

  it('maps aborted requests to TIMEOUT', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .delay(20)
      .reply(200, {
        id: 'chatcmpl-timeout',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Too late.' },
            finish_reason: 'stop',
          },
        ],
      });

    const result = await createClientWithConfig({ timeoutMs: 1 }).run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      promptType: 'github-agent-pr-triage',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TIMEOUT');
  });

  it('fails before fetch when the shared deadline is already exhausted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const result = await createClientWithConfig({ deadlineAtMs: Date.now() - 1 }).run({
        systemPrompt: 'Test',
        messages: [{ role: 'user', content: 'test' }],
        tools: [],
        promptType: 'github-agent-pr-triage',
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('aborts while a successful response body is still being consumed', async () => {
    nock(API_BASE_URL)
      .post('/chat/completions')
      .delayBody(50)
      .reply(200, {
        id: 'chatcmpl-delayed-body',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'Too late.' } }],
      });

    const result = await createClientWithConfig({ timeoutMs: 10 }).run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      promptType: 'github-agent-pr-triage',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });

  it('retries a transient provider HTTP 500 up to the configured attempt cap', async () => {
    nock(API_BASE_URL).post('/chat/completions').reply(500, 'Server error');
    nock(API_BASE_URL)
      .post('/chat/completions')
      .reply(200, {
        id: 'chatcmpl-recovered',
        model: TEST_MODEL,
        created: Date.now(),
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'Recovered.' } }],
      });

    const client = createClientWithConfig({ maxAttempts: 2 } as Partial<
      Parameters<typeof createOpenRouterToolCallingClient>[0]
    >);
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      promptType: 'github-agent-pr-triage',
    });

    expect(result).toMatchObject({ ok: true, value: { content: 'Recovered.' } });
    expect(nock.isDone()).toBe(true);
  });
});
