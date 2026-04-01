import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { ModelPricing, ToolCallingClient } from '@intexuraos/llm-contract';
import type { AuditSink } from '@intexuraos/llm-audit';
import type { UsageSink } from '@intexuraos/llm-pricing';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
  }
  const FunctionCallingConfigMode = {
    MODE_UNSPECIFIED: 'MODE_UNSPECIFIED',
    AUTO: 'AUTO',
    ANY: 'ANY',
    NONE: 'NONE',
    VALIDATED: 'VALIDATED',
  } as const;
  return { GoogleGenAI: MockGoogleGenAI, FunctionCallingConfigMode };
});

vi.mock('@intexuraos/llm-audit', () => ({
  createAuditContext: vi.fn().mockReturnValue({
    success: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockUsageLoggerLog = vi.fn().mockResolvedValue(undefined);

vi.mock('@intexuraos/llm-pricing', () => ({
  createUsageLogger: vi.fn().mockReturnValue({
    log: mockUsageLoggerLog,
  }),
}));

const { createUsageLogger } = await import('@intexuraos/llm-pricing');
const { createAuditContext } = await import('@intexuraos/llm-audit');
const { createGeminiToolCallingClient, TOOL_CALLING_PRICING } =
  await import('../toolCallingClient.js');

const TEST_MODEL = LlmModels.Gemini25Flash;

const TEST_PRICING: ModelPricing = {
  inputPricePerMillion: 0.5,
  outputPricePerMillion: 2.0,
  groundingCostPerRequest: 0,
};

function createClient(): ToolCallingClient {
  return createGeminiToolCallingClient({
    apiKey: 'test-key',
    model: TEST_MODEL,
    userId: 'test-user',
    pricing: TEST_PRICING,
    logger: mockLogger,
  });
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helper with complex inline return
function textResponse(text: string, inputTokens = 10, outputTokens = 20) {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] } }],
    usageMetadata: {
      promptTokenCount: inputTokens,
      candidatesTokenCount: outputTokens,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helper with complex inline return
function functionCallResponse(
  name: string,
  args: Record<string, unknown>,
  inputTokens = 10,
  outputTokens = 5
) {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ functionCall: { name, args } }],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: inputTokens,
      candidatesTokenCount: outputTokens,
    },
  };
}

describe('createGeminiToolCallingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns text response when no tools are called', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      textResponse('No review needed — backend only changes.')
    );

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'You are a test agent.',
      messages: [{ role: 'user', content: 'Analyze this PR' }],
      tools: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('No review needed — backend only changes.');
    expect(result.value.toolCallsMade).toBe(0);
    expect(result.value.iterationCount).toBe(1);
    expect(result.value.usage.inputTokens).toBe(10);
    expect(result.value.usage.outputTokens).toBe(20);
  });

  it('executes tool call and returns final text', async () => {
    const mockRun = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ status: 'dispatched', taskId: 'task_123' }));

    // Iteration 1: function call
    mockGenerateContent.mockResolvedValueOnce(
      functionCallResponse('request_review', { review_type: 'frontend' })
    );
    // Iteration 2: final text
    mockGenerateContent.mockResolvedValueOnce(
      textResponse('Dispatched frontend review for PR #42.')
    );

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'You are a test agent.',
      messages: [{ role: 'user', content: 'Analyze PR #42' }],
      tools: [
        {
          name: 'request_review',
          description: 'Dispatch a review',
          parameters: {
            type: 'object',
            properties: { review_type: { type: 'string' } },
          },
          run: mockRun,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Dispatched frontend review for PR #42.');
    expect(result.value.toolCallsMade).toBe(1);
    expect(result.value.iterationCount).toBe(2);
    expect(mockRun).toHaveBeenCalledWith({ review_type: 'frontend' });
    // Usage aggregated across both iterations
    expect(result.value.usage.inputTokens).toBe(20);
    expect(result.value.usage.outputTokens).toBe(25);
  });

  it('sends functionResponse with role "user" as expected by @google/genai SDK', async () => {
    const mockRun = vi.fn().mockResolvedValue('{"status":"ok"}');

    mockGenerateContent.mockResolvedValueOnce(
      functionCallResponse('request_review', { review_type: 'frontend' })
    );
    mockGenerateContent.mockResolvedValueOnce(textResponse('done'));

    const client = createClient();
    await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: mockRun,
        },
      ],
    });

    // Second call should include the functionCall (model) and functionResponse (user) contents
    const secondCallContents = mockGenerateContent.mock.calls[1]?.[0]?.contents as
      | { role: string; parts: unknown[] }[]
      | undefined;
    expect(secondCallContents).toBeDefined();
    if (secondCallContents === undefined) return;

    // Model's functionCall part
    expect(secondCallContents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'request_review', args: { review_type: 'frontend' } } }],
    });

    // Our functionResponse part — must be 'user' for @google/genai SDK
    expect(secondCallContents[2]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'request_review',
            response: { result: '{"status":"ok"}' },
          },
        },
      ],
    });
  });

  it('sends error for hallucinated tool name', async () => {
    // Iteration 1: hallucinated tool
    mockGenerateContent.mockResolvedValueOnce(
      functionCallResponse('nonexistent_tool', { arg: 'value' })
    );
    // Iteration 2: model self-corrects with text
    mockGenerateContent.mockResolvedValueOnce(textResponse('Sorry, no review needed.'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: vi.fn(),
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toolCallsMade).toBe(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'nonexistent_tool' }),
      'Tool calling: hallucinated tool name'
    );
  });

  it('catches run callback errors and sends error response to LLM', async () => {
    // Iteration 1: tool call
    mockGenerateContent.mockResolvedValueOnce(
      functionCallResponse('request_review', { review_type: 'frontend' })
    );
    // Iteration 2: final text after error
    mockGenerateContent.mockResolvedValueOnce(textResponse('Review dispatch failed.'));

    const failingRun = vi.fn().mockRejectedValue(new Error('DB connection lost'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: failingRun,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Review dispatch failed.');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'DB connection lost' }),
      'Tool calling: run callback threw'
    );
  });

  it('returns error when maxIterations exhausted without text', async () => {
    // All iterations return function calls
    mockGenerateContent.mockResolvedValue(
      functionCallResponse('request_review', { review_type: 'frontend' })
    );

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: vi.fn().mockResolvedValue('{"status":"ok"}'),
        },
      ],
      maxIterations: 2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
    expect(result.error.message).toContain('maxIterations');
  });

  it('processes functionCall first when both functionCall and text in response', async () => {
    const mockRun = vi.fn().mockResolvedValue('{"status":"dispatched"}');

    // Response has BOTH functionCall and text parts
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { functionCall: { name: 'request_review', args: { review_type: 'frontend' } } },
              { text: 'I am dispatching a review.' },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 15 },
    });
    // After tool call, model returns final text
    mockGenerateContent.mockResolvedValueOnce(textResponse('Frontend review dispatched.'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: mockRun,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // functionCall was processed (tool was called)
    expect(mockRun).toHaveBeenCalledWith({ review_type: 'frontend' });
    expect(result.value.toolCallsMade).toBe(1);
    // Final text comes from the second iteration (text in first was ignored)
    expect(result.value.content).toBe('Frontend review dispatched.');
    expect(result.value.iterationCount).toBe(2);
  });

  it('returns last text when maxIterations exhausted with text in final response', async () => {
    // Both iterations return functionCall, but the last one also has text
    mockGenerateContent.mockResolvedValueOnce(
      functionCallResponse('request_review', { review_type: 'frontend' })
    );
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { functionCall: { name: 'request_review', args: { review_type: 'backend' } } },
              { text: 'Ran out of iterations but here is my summary.' },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: vi.fn().mockResolvedValue('{"status":"ok"}'),
        },
      ],
      maxIterations: 2,
    });

    // Should return the text from the last response instead of error
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Ran out of iterations but here is my summary.');
    expect(result.value.toolCallsMade).toBe(2);
  });

  it('returns error on empty response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { role: 'model', parts: [] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
    });

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Empty response from model');
  });

  it('maps Gemini API errors correctly', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('429 quota exceeded'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RATE_LIMITED');
  });

  it('maps SAFETY errors to CONTENT_FILTERED', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('SAFETY filter blocked response'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTENT_FILTERED');
  });

  it('passes systemPrompt in config.systemInstruction', async () => {
    mockGenerateContent.mockResolvedValueOnce(textResponse('ok'));

    const client = createClient();
    await client.run({
      systemPrompt: 'You are a GitHub Agent.',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          systemInstruction: 'You are a GitHub Agent.',
        }),
      })
    );
  });

  it('tracks usage with tool_calling call type', async () => {
    mockGenerateContent.mockResolvedValueOnce(textResponse('ok'));

    const client = createClient();
    await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(mockUsageLoggerLog).toHaveBeenCalledWith(
      expect.objectContaining({
        callType: 'tool_calling',
        success: true,
      })
    );
  });

  it('exports TOOL_CALLING_PRICING with gemini-2.5-flash', () => {
    expect(TOOL_CALLING_PRICING[LlmModels.Gemini25Flash]).toEqual({
      inputPricePerMillion: 0.3,
      outputPricePerMillion: 2.5,
      groundingCostPerRequest: 0,
    });
  });

  it('includes thinking tokens in aggregated usage', async () => {
    // First call: tool call with thinking tokens
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'get_weather',
                  args: { city: 'London' },
                },
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 50,
      },
    });
    // Second call: final text response with thinking tokens
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [{ text: 'The weather in London is sunny.' }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 200,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 80,
      },
    });

    const pricing: ModelPricing = {
      inputPricePerMillion: 0.3,
      outputPricePerMillion: 2.5,
      groundingCostPerRequest: 0,
    };
    const client = createGeminiToolCallingClient({
      apiKey: 'test-key',
      model: LlmModels.Gemini25Flash,
      userId: 'test-user',
      pricing,
      logger: mockLogger,
    });

    const result = await client.run({
      systemPrompt: 'You are a weather assistant.',
      messages: [{ role: 'user', content: 'Weather in London?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
          run: async () => JSON.stringify({ temp: 20, condition: 'sunny' }),
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Aggregated: input 100+200=300, output 20+30=50, thinking 50+80=130
      expect(result.value.usage.inputTokens).toBe(300);
      expect(result.value.usage.outputTokens).toBe(50);
      expect(result.value.usage.thinkingTokens).toBe(130);
      // Cost: (300*0.3 + 50*2.5 + 130*2.5) / 1_000_000 = (90 + 125 + 325) / 1_000_000 = 0.00054
      expect(result.value.usage.costUsd).toBeCloseTo(0.00054, 6);
    }
  });

  it('passes usageSink to createUsageLogger when provided', async () => {
    const fakeSink: UsageSink = {
      log: vi.fn().mockResolvedValue(undefined),
    };
    mockGenerateContent.mockResolvedValueOnce(textResponse('ok'));

    const client = createGeminiToolCallingClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      pricing: TEST_PRICING,
      logger: mockLogger,
      usageSink: fakeSink,
    });
    await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(createUsageLogger).toHaveBeenCalledWith(expect.objectContaining({ sink: fakeSink }));
  });

  it('passes auditSink to createAuditContext when provided', async () => {
    const fakeAuditSink: AuditSink = {
      save: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    };
    mockGenerateContent.mockResolvedValueOnce(textResponse('ok'));

    const client = createGeminiToolCallingClient({
      apiKey: 'test-key',
      model: TEST_MODEL,
      userId: 'test-user',
      pricing: TEST_PRICING,
      logger: mockLogger,
      auditSink: fakeAuditSink,
    });
    await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(createAuditContext).toHaveBeenCalledWith(
      expect.objectContaining({ provider: LlmProviders.Google, model: TEST_MODEL }),
      expect.objectContaining({ sink: fakeAuditSink })
    );
  });

  it('maps assistant role to model in contents', async () => {
    mockGenerateContent.mockResolvedValueOnce(textResponse('ok'));

    const client = createClient();
    await client.run({
      systemPrompt: 'Test',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'Do something' },
      ],
      tools: [],
    });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi there' }] },
          { role: 'user', parts: [{ text: 'Do something' }] },
        ],
      })
    );
  });

  it('defaults to 0 tokens when usageMetadata is missing', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
    });

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usage.inputTokens).toBe(0);
    expect(result.value.usage.outputTokens).toBe(0);
  });

  it('defaults to empty parts when candidates are missing', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
    });

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Empty response from model');
  });

  it('defaults toolName to empty string when undefined', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ functionCall: { name: undefined, args: { a: 1 } } }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    mockGenerateContent.mockResolvedValueOnce(textResponse('done'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'my_tool',
          description: 'A tool',
          parameters: {},
          run: vi.fn().mockResolvedValue('ok'),
        },
      ],
    });

    expect(result.ok).toBe(true);
    // The empty string tool name won't match 'my_tool', so it's hallucinated
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: '' }),
      'Tool calling: hallucinated tool name'
    );
  });

  it('defaults toolArgs to empty object when undefined', async () => {
    const mockRun = vi.fn().mockResolvedValue('{"result":"ok"}');

    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ functionCall: { name: 'my_tool', args: undefined } }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    mockGenerateContent.mockResolvedValueOnce(textResponse('done'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'my_tool',
          description: 'A tool',
          parameters: {},
          run: mockRun,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(mockRun).toHaveBeenCalledWith({});
  });

  it('truncates long tool responses in log output', async () => {
    const longResponse = 'x'.repeat(300);
    const mockRun = vi.fn().mockResolvedValue(longResponse);

    mockGenerateContent.mockResolvedValueOnce(functionCallResponse('my_tool', { a: 1 }));
    mockGenerateContent.mockResolvedValueOnce(textResponse('done'));

    const client = createClient();
    await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'my_tool',
          description: 'A tool',
          parameters: {},
          run: mockRun,
        },
      ],
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        toolResponseTruncated: 'x'.repeat(200) + '...',
      }),
      'Tool calling: iteration with tool call'
    );
  });

  it('maps API_KEY errors to INVALID_KEY', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('API_KEY is invalid or missing'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_KEY');
  });

  it('maps timeout errors to TIMEOUT', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Request timeout after 30s'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TIMEOUT');
  });

  it('maps unknown errors to API_ERROR as fallback', async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error('Something completely unexpected happened')
    );

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
    expect(result.error.message).toBe('Something completely unexpected happened');
  });

  it('maps quota-only error to RATE_LIMITED', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Resource quota exhausted'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RATE_LIMITED');
  });

  it('maps 429-only error (without quota) to RATE_LIMITED', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RATE_LIMITED');
  });

  it('maps blocked-only error (without SAFETY) to CONTENT_FILTERED', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Response was blocked by policy'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTENT_FILTERED');
  });

  it('maps non-Error thrown value (string) to API_ERROR', async () => {
    mockGenerateContent.mockRejectedValueOnce('plain string error');

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
  });

  it('maps non-Error thrown value (null) to API_ERROR', async () => {
    mockGenerateContent.mockRejectedValueOnce(null);

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
  });

  it('maps non-Error thrown value (number) to API_ERROR', async () => {
    mockGenerateContent.mockRejectedValueOnce(500);

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
  });

  it('maps non-Error thrown value (object without message) to API_ERROR', async () => {
    mockGenerateContent.mockRejectedValueOnce({ status: 503, reason: 'unavailable' });

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
  });

  it('preserves error message in mapped result', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('API_KEY was revoked by admin'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_KEY');
    expect(result.error.message).toBe('API_KEY was revoked by admin');
  });

  it('maps SAFETY-only error (without blocked) to CONTENT_FILTERED', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('SAFETY: content violates usage policy'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTENT_FILTERED');
  });

  it('calls onExhausted when maxIterations exhausted without text', async () => {
    const mockRun = vi.fn().mockResolvedValue('{"status":"ok"}');
    const onExhausted = vi.fn().mockReturnValue(undefined);

    // All iterations return function calls
    mockGenerateContent.mockResolvedValue(
      functionCallResponse('request_review', { review_type: 'frontend' })
    );

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: mockRun,
        },
      ],
      maxIterations: 2,
      onExhausted,
    });

    expect(onExhausted).toHaveBeenCalledWith({ iterationCount: 2, toolCallsMade: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('maxIterations');
  });

  it('injects repair message and continues loop', async () => {
    const mockRun = vi.fn().mockResolvedValue('{"status":"ok"}');
    const onExhausted = vi.fn().mockReturnValue('Please respond with text now.');

    // Iterations 1-2: function calls (exhaust maxIterations=2)
    mockGenerateContent
      .mockResolvedValueOnce(functionCallResponse('request_review', { review_type: 'frontend' }))
      .mockResolvedValueOnce(functionCallResponse('request_review', { review_type: 'backend' }))
      // After repair injection, LLM returns text
      .mockResolvedValueOnce(textResponse('Here is my final answer.'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: mockRun,
        },
      ],
      maxIterations: 2,
      onExhausted,
    });

    expect(onExhausted).toHaveBeenCalledWith({ iterationCount: 2, toolCallsMade: 2 });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ iteration: 2, totalToolCalls: 2 }),
      'Tool calling: repair message injected'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Here is my final answer.');
    expect(result.value.iterationCount).toBe(3);
    expect(result.value.toolCallsMade).toBe(2);
  });

  it('fails when onExhausted returns undefined', async () => {
    const mockRun = vi.fn().mockResolvedValue('{"status":"ok"}');
    const onExhausted = vi.fn().mockReturnValue(undefined);

    mockGenerateContent.mockResolvedValue(
      functionCallResponse('request_review', { review_type: 'frontend' })
    );

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: mockRun,
        },
      ],
      maxIterations: 2,
      onExhausted,
    });

    expect(onExhausted).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
    expect(result.error.message).toContain('maxIterations');
  });

  it('fails when repair iterations also exhaust', async () => {
    const mockRun = vi.fn().mockResolvedValue('{"status":"ok"}');
    const onExhausted = vi.fn().mockReturnValue('Please respond with text.');

    // All responses are function calls — even after repair
    mockGenerateContent.mockResolvedValue(
      functionCallResponse('request_review', { review_type: 'frontend' })
    );

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'request_review',
          description: 'Review',
          parameters: {},
          run: mockRun,
        },
      ],
      maxIterations: 2,
      repairIterations: 1,
      onExhausted,
    });

    expect(onExhausted).toHaveBeenCalledOnce();
    // 2 initial + 1 repair = 3 total iterations
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('API_ERROR');
    expect(result.error.message).toContain('maxIterations');
  });

  it('sends mode ANY on first iteration when tools are provided', async () => {
    mockGenerateContent.mockResolvedValueOnce(textResponse('ok'));

    const client = createClient();
    await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'my_tool',
          description: 'A tool',
          parameters: {},
          run: vi.fn().mockResolvedValue('ok'),
        },
      ],
    });

    const config = mockGenerateContent.mock.calls[0]?.[0]?.config as
      | { toolConfig?: { functionCallingConfig?: { mode?: string } } }
      | undefined;
    expect(config?.toolConfig?.functionCallingConfig?.mode).toBe('ANY');
  });

  it('sends mode AUTO on second iteration after a tool call', async () => {
    mockGenerateContent.mockResolvedValueOnce(functionCallResponse('my_tool', { a: 1 }));
    mockGenerateContent.mockResolvedValueOnce(textResponse('done'));

    const client = createClient();
    await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'my_tool',
          description: 'A tool',
          parameters: {},
          run: vi.fn().mockResolvedValue('{"ok":true}'),
        },
      ],
    });

    const secondConfig = mockGenerateContent.mock.calls[1]?.[0]?.config as
      | { toolConfig?: { functionCallingConfig?: { mode?: string } } }
      | undefined;
    expect(secondConfig?.toolConfig?.functionCallingConfig?.mode).toBe('AUTO');
  });

  it('does not include toolConfig when no tools are provided', async () => {
    mockGenerateContent.mockResolvedValueOnce(textResponse('ok'));

    const client = createClient();
    await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
    });

    const config = mockGenerateContent.mock.calls[0]?.[0]?.config as
      | { toolConfig?: unknown }
      | undefined;
    expect(config?.toolConfig).toBeUndefined();
  });

  it('does not call onExhausted when text response received', async () => {
    const onExhausted = vi.fn().mockReturnValue('repair');

    mockGenerateContent.mockResolvedValueOnce(textResponse('All good.'));

    const client = createClient();
    const result = await client.run({
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'test' }],
      tools: [],
      onExhausted,
    });

    expect(onExhausted).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('All good.');
  });

  describe('toolConfig mode enforcement', () => {
    it('sends mode ANY on first iteration when tools are provided', async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse('done'));

      const client = createClient();
      await client.run({
        systemPrompt: 'triage agent',
        messages: [{ role: 'user', content: 'eval PR' }],
        tools: [
          {
            name: 'skip',
            description: 'Skip this PR',
            parameters: {
              type: 'object',
              properties: { reason: { type: 'string' } },
              required: ['reason'],
            },
            run: async (): Promise<string> => JSON.stringify({ success: true }),
          },
        ],
      });

      const firstCallConfig = mockGenerateContent.mock.calls[0]?.[0]?.config as
        | { toolConfig?: { functionCallingConfig?: { mode?: string } } }
        | undefined;
      expect(firstCallConfig?.toolConfig?.functionCallingConfig?.mode).toBe('ANY');
    });

    it('sends mode AUTO on second iteration after a tool call', async () => {
      const skipTool = {
        name: 'skip',
        description: 'Skip',
        parameters: {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
        },
        run: async (): Promise<string> => JSON.stringify({ success: true }),
      };

      mockGenerateContent
        .mockResolvedValueOnce(functionCallResponse('skip', { reason: 'trivial' }))
        .mockResolvedValueOnce(textResponse('Skipped because trivial.'));

      const client = createClient();
      await client.run({
        systemPrompt: 'triage agent',
        messages: [{ role: 'user', content: 'eval PR' }],
        tools: [skipTool],
      });

      const secondCallConfig = mockGenerateContent.mock.calls[1]?.[0]?.config as
        | { toolConfig?: { functionCallingConfig?: { mode?: string } } }
        | undefined;
      expect(secondCallConfig?.toolConfig?.functionCallingConfig?.mode).toBe('AUTO');
    });

    it('does NOT add toolConfig when no tools are provided', async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse('plain text response'));

      const client = createClient();
      await client.run({
        systemPrompt: 'simple agent',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [],
      });

      const callConfig = mockGenerateContent.mock.calls[0]?.[0]?.config as
        | { toolConfig?: unknown }
        | undefined;
      expect(callConfig?.toolConfig).toBeUndefined();
    });
  });
});
