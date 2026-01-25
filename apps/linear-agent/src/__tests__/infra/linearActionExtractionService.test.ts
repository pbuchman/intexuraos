/**
 * Tests for Linear action extraction service.
 * Tests the factory function and uses a fake LLM client for behavior testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { GenerateResult, LlmGenerateClient } from '@intexuraos/llm-factory';
import type {
  LlmUserServiceClient,
  LlmUserServiceError,
} from '../../infra/user/llmUserServiceClient.js';
import {
  createLinearActionExtractionService,
  type LinearActionExtractionService,
} from '../../infra/llm/linearActionExtractionService.js';
import type { ExtractedIssueData } from '../../domain/index.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('LinearActionExtractionService', () => {
  let fakeLlmUserService: FakeLlmUserServiceClient;
  let service: LinearActionExtractionService;

  beforeEach(() => {
    fakeLlmUserService = new FakeLlmUserServiceClient();
    service = createLinearActionExtractionService(fakeLlmUserService, silentLogger);
  });

  afterEach(() => {
    fakeLlmUserService.reset();
  });

  describe('extractIssue', () => {
    const validExtractedResponse: ExtractedIssueData = {
      title: 'Fix authentication bug',
      priority: 2,
      functionalRequirements: 'User should be able to login with Google OAuth',
      technicalDetails: 'Check token validation in auth.ts',
      valid: true,
      error: null,
      reasoning: 'Issue is clear and actionable',
    };

    it('returns extracted issue data for valid LLM response', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify(validExtractedResponse),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix authentication bug');
        expect(result.value.priority).toBe(2);
        expect(result.value.functionalRequirements).toBe('User should be able to login with Google OAuth');
        expect(result.value.technicalDetails).toBe('Check token validation in auth.ts');
        expect(result.value.valid).toBe(true);
        expect(result.value.reasoning).toBe('Issue is clear and actionable');
      }
    });

    it('handles markdown code block wrapped responses', async () => {
      fakeLlmUserService.setLlmResponse({
        content: '```json\n' + JSON.stringify(validExtractedResponse) + '\n```',
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix authentication bug');
      }
    });

    it('handles plain code block wrapped responses (without json label)', async () => {
      fakeLlmUserService.setLlmResponse({
        content: '```\n' + JSON.stringify(validExtractedResponse) + '\n```',
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix authentication bug');
      }
    });

    it('returns NOT_CONNECTED error when user has no API key', async () => {
      fakeLlmUserService.setLlmUserError({
        code: 'NO_API_KEY',
        message: 'No API key configured for Anthropic',
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toContain('No API key configured');
      }
    });

    it('returns INTERNAL_ERROR for other user service errors', async () => {
      fakeLlmUserService.setLlmUserError({
        code: 'API_ERROR',
        message: 'Failed to fetch user settings',
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Failed to fetch user settings');
      }
    });

    it('returns INTERNAL_ERROR for NETWORK_ERROR', async () => {
      fakeLlmUserService.setLlmUserError({
        code: 'NETWORK_ERROR',
        message: 'ECONNREFUSED',
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('ECONNREFUSED');
      }
    });

    it('returns EXTRACTION_FAILED when LLM generation fails', async () => {
      fakeLlmUserService.setLlmGenerateError({
        code: 'RATE_LIMITED',
        message: 'Too many requests',
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toBe('Too many requests');
      }
    });

    it('returns EXTRACTION_FAILED for malformed JSON response', async () => {
      fakeLlmUserService.setLlmResponse({
        content: 'this is not valid json {',
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('Failed to parse');
      }
    });

    it('returns EXTRACTION_FAILED for invalid response structure', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          // Missing required fields
          title: 'Bug',
          // Missing priority, valid, reasoning, etc.
        }),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
      }
    });

    it('validates priority range (0-4)', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          ...validExtractedResponse,
          priority: 5, // Invalid: must be 0-4
        }),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
        expect(result.error.message).toContain('priority');
      }
    });

    it('validates negative priority', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          ...validExtractedResponse,
          priority: -1, // Invalid: must be 0-4
        }),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
        expect(result.error.message).toContain('priority');
      }
    });

    it('validates title is a string', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          ...validExtractedResponse,
          title: null as unknown as string,
        }),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
        expect(result.error.message).toContain('title');
      }
    });

    it('accepts null functionalRequirements and technicalDetails', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          title: 'Simple issue',
          priority: 0,
          functionalRequirements: null,
          technicalDetails: null,
          valid: true,
          error: null,
          reasoning: 'Basic issue',
        }),
      });

      const result = await service.extractIssue('user-123', 'Simple issue');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.functionalRequirements).toBeNull();
        expect(result.value.technicalDetails).toBeNull();
      }
    });

    it('accepts string functionalRequirements and technicalDetails', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          title: 'Complex issue',
          priority: 1,
          functionalRequirements: 'Must support OAuth2',
          technicalDetails: 'Use passport.js',
          valid: true,
          error: null,
          reasoning: 'Well-defined',
        }),
      });

      const result = await service.extractIssue('user-123', 'Complex issue');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.functionalRequirements).toBe('Must support OAuth2');
        expect(result.value.technicalDetails).toBe('Use passport.js');
      }
    });

    it('validates functionalRequirements must be null or string (rejects number)', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          ...validExtractedResponse,
          functionalRequirements: 123 as unknown as string,
        }),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
        expect(result.error.message).toContain('functionalRequirements');
      }
    });

    it('validates technicalDetails must be null or string (rejects number)', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          ...validExtractedResponse,
          technicalDetails: 456 as unknown as string,
        }),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
        expect(result.error.message).toContain('technicalDetails');
      }
    });

    it('validates reasoning must be string (rejects number)', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          ...validExtractedResponse,
          reasoning: 789 as unknown as string,
        }),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
        expect(result.error.message).toContain('reasoning');
      }
    });

    it('validates response must be an object (rejects null parsed value)', async () => {
      // JSON.parse('null') returns null, which should fail validation
      fakeLlmUserService.setLlmResponse({
        content: 'null',
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
      }
    });

    it('validates error must be null or string', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          ...validExtractedResponse,
          error: 123 as unknown as string,
        }),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
        expect(result.error.message).toContain('error');
      }
    });

    it('validates valid must be boolean', async () => {
      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify({
          ...validExtractedResponse,
          valid: 'true' as unknown as boolean,
        }),
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('LLM returned invalid response format');
        expect(result.error.message).toContain('valid');
      }
    });

    it('handles response with valid=false and error message', async () => {
      const invalidIssueResponse: ExtractedIssueData = {
        title: 'Unclear request',
        priority: 0,
        functionalRequirements: null,
        technicalDetails: null,
        valid: false,
        error: 'The input is too vague. Please provide more details about the issue.',
        reasoning: 'User said "fix it" without context',
      };

      fakeLlmUserService.setLlmResponse({
        content: JSON.stringify(invalidIssueResponse),
      });

      const result = await service.extractIssue('user-123', 'fix it');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.valid).toBe(false);
        expect(result.value.error).toBe('The input is too vague. Please provide more details about the issue.');
        expect(result.value.reasoning).toBe('User said "fix it" without context');
      }
    });

    it('trims whitespace from response before parsing', async () => {
      fakeLlmUserService.setLlmResponse({
        content: '  \n  ' + JSON.stringify(validExtractedResponse) + '  \n  ',
      });

      const result = await service.extractIssue('user-123', 'Fix login bug');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix authentication bug');
      }
    });
  });
});

/**
 * Fake implementation of LlmUserServiceClient for testing.
 */
class FakeLlmUserServiceClient implements LlmUserServiceClient {
  private llmResponseContent: string | null = null;
  private llmUserError: LlmUserServiceError | null = null;
  private llmGenerateError: { code: string; message: string } | null = null;

  async getLlmClient(
    _userId: string
  ): Promise<
    Result<
      LlmGenerateClient,
      LlmUserServiceError
    >
  > {
    if (this.llmUserError) {
      return err(this.llmUserError);
    }

    // Capture instance variables for closure
    const responseContent = this.llmResponseContent;
    const generateError = this.llmGenerateError;

    const fakeLlmClient: LlmGenerateClient = {
      async generate(_prompt: string): Promise<Result<GenerateResult, { code: string; message: string }>> {
        if (generateError) {
          return err(generateError);
        }

        if (responseContent !== null) {
          return ok({
            content: responseContent,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
          });
        }

        return err({ code: 'INTERNAL_ERROR', message: 'No response configured' });
      },
    } as unknown as LlmGenerateClient;

    return ok(fakeLlmClient);
  }

  setLlmResponse(response: { content: string }): void {
    this.llmResponseContent = response.content;
  }

  setLlmUserError(error: LlmUserServiceError): void {
    this.llmUserError = error;
  }

  setLlmGenerateError(error: { code: string; message: string }): void {
    this.llmGenerateError = error;
  }

  reset(): void {
    this.llmResponseContent = null;
    this.llmUserError = null;
    this.llmGenerateError = null;
  }
}
