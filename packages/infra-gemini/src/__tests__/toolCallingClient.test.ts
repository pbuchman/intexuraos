import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmModels } from '@intexuraos/llm-contract';
import type { ModelPricing } from '@intexuraos/llm-contract';
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
  return { GoogleGenAI: MockGoogleGenAI };
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

const { createGeminiToolCallingClient, TOOL_CALLING_PRICING } = await import(
  '../toolCallingClient.js'
);

const TEST_MODEL = LlmModels.Gemini25Flash;

const TEST_PRICING: ModelPricing = {
  inputPricePerMillion: 0.5,
  outputPricePerMillion: 2.0,
  groundingCostPerRequest: 0,
};

function createClient() {
  return createGeminiToolCallingClient({
    apiKey: 'test-key',
    model: TEST_MODEL,
    userId: 'test-user',
    pricing: TEST_PRICING,
    logger: mockLogger,
  });
}

function textResponse(text: string, inputTokens = 10, outputTokens = 20) {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] } }],
    usageMetadata: {
      promptTokenCount: inputTokens,
      candidatesTokenCount: outputTokens,
    },
  };
}

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
    expect(result.value.content).toBe(
      'No review needed — backend only changes.'
    );
    expect(result.value.toolCallsMade).toBe(0);
    expect(result.value.iterationCount).toBe(1);
    expect(result.value.usage.inputTokens).toBe(10);
    expect(result.value.usage.outputTokens).toBe(20);
  });

  it('executes tool call and returns final text', async () => {
    const mockRun = vi.fn().mockResolvedValue(
      JSON.stringify({ status: 'dispatched', taskId: 'task_123' })
    );

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
    expect(result.value.content).toBe(
      'Dispatched frontend review for PR #42.'
    );
    expect(result.value.toolCallsMade).toBe(1);
    expect(result.value.iterationCount).toBe(2);
    expect(mockRun).toHaveBeenCalledWith({ review_type: 'frontend' });
    // Usage aggregated across both iterations
    expect(result.value.usage.inputTokens).toBe(20);
    expect(result.value.usage.outputTokens).toBe(25);
  });

  it('sends error for hallucinated tool name', async () => {
    // Iteration 1: hallucinated tool
    mockGenerateContent.mockResolvedValueOnce(
      functionCallResponse('nonexistent_tool', { arg: 'value' })
    );
    // Iteration 2: model self-corrects with text
    mockGenerateContent.mockResolvedValueOnce(
      textResponse('Sorry, no review needed.')
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
    mockGenerateContent.mockResolvedValueOnce(
      textResponse('Review dispatch failed.')
    );

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
    mockGenerateContent.mockResolvedValueOnce(
      textResponse('Frontend review dispatched.')
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
    expect(result.value.content).toBe(
      'Ran out of iterations but here is my summary.'
    );
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
    expect(TOOL_CALLING_PRICING['gemini-2.5-flash']).toEqual({
      inputPricePerMillion: 0.5,
      outputPricePerMillion: 2.0,
      groundingCostPerRequest: 0,
    });
  });
});
