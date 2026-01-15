import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { createCalendarActionExtractionService } from '../infra/gemini/calendarActionExtractionService.js';
import type { LlmUserServiceClient } from '../infra/user/llmUserServiceClient.js';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import pino from 'pino';

const mockGenerate = vi.fn();

const mockLogger: pino.Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  level: 'info',
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  msgPrefix: '',
} as unknown as pino.Logger;

describe('calendarActionExtractionService', () => {
  let mockUserServiceClient: LlmUserServiceClient;
  let mockLlmClient: LlmGenerateClient;

  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue(
      ok({
        content: JSON.stringify({
          summary: 'Team meeting',
          start: '2025-01-15T14:00:00',
          end: '2025-01-15T15:00:00',
          location: 'Conference Room A',
          description: 'Weekly team sync',
          valid: true,
          error: null,
          reasoning: 'Clear meeting request with time and location',
        }),
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      })
    );

    mockLlmClient = { generate: mockGenerate };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createMockUserServiceClient(
    result: 'ok' | 'no_api_key' | 'api_error' | 'network_error' | 'invalid_model' = 'ok'
  ): LlmUserServiceClient {
    switch (result) {
      case 'ok':
        return {
          getLlmClient: vi.fn().mockResolvedValue(ok(mockLlmClient)),
        };
      case 'no_api_key':
        return {
          getLlmClient: vi
            .fn()
            .mockResolvedValue(err({ code: 'NO_API_KEY' as const, message: 'No API key configured' })),
        };
      case 'api_error':
        return {
          getLlmClient: vi.fn().mockResolvedValue(err({ code: 'API_ERROR' as const, message: 'Service error' })),
        };
      case 'network_error':
        return {
          getLlmClient: vi
            .fn()
            .mockResolvedValue(err({ code: 'NETWORK_ERROR' as const, message: 'Network error' })),
        };
      case 'invalid_model':
        return {
          getLlmClient: vi
            .fn()
            .mockResolvedValue(err({ code: 'INVALID_MODEL' as const, message: 'Unsupported model' })),
        };
    }
  }

  describe('extractEvent', () => {
    const mockUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 };

    it('extracts event successfully from text', async () => {
      const validResponse = JSON.stringify({
        summary: 'Doctor appointment',
        start: '2025-01-20T10:00:00',
        end: '2025-01-20T11:00:00',
        location: 'Medical Center',
        description: 'Annual checkup',
        valid: true,
        error: null,
        reasoning: 'Medical appointment with specific time',
      });

      mockGenerate.mockResolvedValue(ok({ content: validResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Doctor appointment at 10am tomorrow', '2025-01-19');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('Doctor appointment');
        expect(result.value.start).toBe('2025-01-20T10:00:00');
        expect(result.value.end).toBe('2025-01-20T11:00:00');
        expect(result.value.location).toBe('Medical Center');
        expect(result.value.description).toBe('Annual checkup');
        expect(result.value.valid).toBe(true);
        expect(result.value.error).toBeNull();
      }
    });

    it('returns NO_API_KEY error when user has no API key', async () => {
      mockUserServiceClient = createMockUserServiceClient('no_api_key');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test text', '2025-01-19');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toBe('No API key configured');
      }
    });

    it('returns USER_SERVICE_ERROR when user service fails with API_ERROR', async () => {
      mockUserServiceClient = createMockUserServiceClient('api_error');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test text', '2025-01-19');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_SERVICE_ERROR');
        expect(result.error.message).toBe('Failed to get LLM client: Service error');
        expect(result.error.details?.userServiceError).toBe('Service error');
      }
    });

    it('returns GENERATION_ERROR when LLM generation fails', async () => {
      mockGenerate.mockResolvedValue(err({ code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test text', '2025-01-19');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toBe('LLM generation failed: Rate limit exceeded');
        expect(result.error.details?.llmErrorCode).toBe('RATE_LIMIT_EXCEEDED');
      }
    });

    it('returns INVALID_RESPONSE when JSON parsing fails', async () => {
      mockGenerate.mockResolvedValue(ok({ content: 'not valid json', usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test text', '2025-01-19');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
        expect(result.error.message).toContain('Failed to parse LLM response');
        expect(result.error.details?.parseError).toBeDefined();
        expect(result.error.details?.rawResponsePreview).toBe('not valid json');
      }
    });

    it('returns INVALID_RESPONSE when response schema validation fails', async () => {
      const invalidResponse = JSON.stringify({
        summary: 'Test',
        // Missing required fields
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test text', '2025-01-19');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
        expect(result.error.message).toBe('LLM returned invalid response format');
        expect(result.error.details?.parseError).toBe('Schema validation failed');
      }
    });

    it('strips markdown code blocks from LLM response', async () => {
      const responseWithMarkdown = `\`\`\`json
{
  "summary": "Coffee with John",
  "start": "2025-01-15T10:00:00",
  "end": "2025-01-15T11:00:00",
  "location": "Cafe Downtown",
  "description": null,
  "valid": true,
  "error": null,
  "reasoning": "Social meeting"
}
\`\`\``;

      mockGenerate.mockResolvedValue(ok({ content: responseWithMarkdown, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Coffee with John', '2025-01-14');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('Coffee with John');
        expect(result.value.location).toBe('Cafe Downtown');
      }
    });

    it('handles invalid event (valid=false)', async () => {
      const invalidEventResponse = JSON.stringify({
        summary: 'Unclear request',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: false,
        error: 'Could not determine event time',
        reasoning: 'No specific time mentioned',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidEventResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Maybe do something later', '2025-01-14');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.valid).toBe(false);
        expect(result.value.error).toBe('Could not determine event time');
      }
    });

    it('handles null date fields correctly', async () => {
      const nullDatesResponse = JSON.stringify({
        summary: 'All day event',
        start: '2025-01-15',
        end: null,
        location: null,
        description: 'Company holiday',
        valid: true,
        error: null,
        reasoning: 'All day event with only start date',
      });

      mockGenerate.mockResolvedValue(ok({ content: nullDatesResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Company holiday on Jan 15', '2025-01-14');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.start).toBe('2025-01-15');
        expect(result.value.end).toBeNull();
        expect(result.value.valid).toBe(true);
      }
    });

    it('calls user service with correct userId', async () => {
      mockGenerate.mockResolvedValue(
        ok({
          content: JSON.stringify({
            summary: 'Test',
            start: '2025-01-15T10:00:00',
            end: '2025-01-15T11:00:00',
            location: null,
            description: null,
            valid: true,
            error: null,
            reasoning: 'test',
          }),
          usage: mockUsage,
        })
      );
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      await service.extractEvent('user-abc-456', 'Test text', '2025-01-14');

      expect(mockUserServiceClient.getLlmClient).toHaveBeenCalledWith('user-abc-456');
    });

    it('handles JSON parse error with markdown code blocks', async () => {
      const invalidJsonWithMarkdown = `\`\`\`json
{invalid json}
\`\`\``;

      mockGenerate.mockResolvedValue(ok({ content: invalidJsonWithMarkdown, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
        expect(result.error.details?.wasWrappedInMarkdown).toBe(true);
      }
    });

    it('handles schema validation failure with markdown code blocks', async () => {
      const invalidSchemaWithMarkdown = `\`\`\`json
{
  "summary": "Test",
  "start": null,
  "end": null,
  "location": null,
  "description": null,
  "valid": true,
  "error": null
  // Missing reasoning field
}
\`\`\``;

      mockGenerate.mockResolvedValue(ok({ content: invalidSchemaWithMarkdown, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
        expect(result.error.details?.wasWrappedInMarkdown).toBe(true);
      }
    });

    it('returns INVALID_RESPONSE when JSON root is not an object', async () => {
      mockGenerate.mockResolvedValue(ok({ content: '["not", "an", "object"]', usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('handles null summary value', async () => {
      const nullSummaryResponse = JSON.stringify({
        summary: null,
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: null,
        description: null,
        valid: false,
        error: 'No event summary',
        reasoning: 'Could not determine event title',
      });

      mockGenerate.mockResolvedValue(ok({ content: nullSummaryResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Something maybe', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('handles non-string summary value', async () => {
      const invalidResponse = JSON.stringify({
        summary: 123,
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('handles non-boolean valid value', async () => {
      const invalidResponse = JSON.stringify({
        summary: 'Test',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: null,
        description: null,
        valid: 'true',
        error: null,
        reasoning: 'test',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('handles non-string reasoning value', async () => {
      const invalidResponse = JSON.stringify({
        summary: 'Test',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 123,
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('includes raw response preview for parse errors', async () => {
      mockGenerate.mockResolvedValue(
        ok({
          content: '{invalid json',
          usage: mockUsage,
        })
      );
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
        expect(result.error.details?.rawResponsePreview).toBe('{invalid json');
      }
    });

    it('handles non-string start value', async () => {
      const invalidResponse = JSON.stringify({
        summary: 'Test',
        start: 1234567890,
        end: '2025-01-15T11:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('handles non-string end value', async () => {
      const invalidResponse = JSON.stringify({
        summary: 'Test',
        start: '2025-01-15T10:00:00',
        end: { invalid: 'object' },
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('handles non-string location value', async () => {
      const invalidResponse = JSON.stringify({
        summary: 'Test',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: ['Office'],
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('handles non-string error value', async () => {
      const invalidResponse = JSON.stringify({
        summary: 'Test',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: null,
        description: null,
        valid: false,
        error: { message: 'Error details' },
        reasoning: 'test',
      });

      mockGenerate.mockResolvedValue(ok({ content: invalidResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });

    it('handles null value passed to validator', async () => {
      const nullResponse = 'null';
      mockGenerate.mockResolvedValue(ok({ content: nullResponse, usage: mockUsage }));
      mockUserServiceClient = createMockUserServiceClient('ok');
      const service = createCalendarActionExtractionService(mockUserServiceClient, mockLogger);

      const result = await service.extractEvent('user-123', 'Test', '2025-01-14');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_RESPONSE');
      }
    });
  });
});
