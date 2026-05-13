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
    expect(result.value.usage.costUsd).toBe(0);
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
    expect(capturedBodies[0]?.['tool_choice']).toBe('required');
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
    { status: 503, code: 'OVERLOADED' },
    { status: 500, code: 'API_ERROR' },
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
});
