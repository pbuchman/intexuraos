/**
 * Tests for LinearActionExtractionService.
 * Tests the real implementation using mocked dependencies.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import pino from 'pino';
import { createLinearActionExtractionService } from '../../../infra/llm/linearActionExtractionService.js';
import type {
  ExtractedIssueData,
  LinearPriority,
} from '../../../domain/index.js';
import type {
  DecryptedApiKeys,
  OAuthTokenResult,
  UserServiceClient,
  UserServiceError,
} from '@intexuraos/internal-clients';
import type { Google } from '@intexuraos/llm-contract';
import type {
  LlmGenerateClient,
  GenerateResult,
} from '@intexuraos/llm-factory';
import type { LLMError } from '@intexuraos/llm-contract';

// Fake LLM client
class FakeLlmClient implements LlmGenerateClient {
  private shouldFail = false;
  private error: LLMError = { code: 'RATE_LIMITED', message: 'LLM failed' };
  private response = '';

  async generate(_prompt: string): Promise<Result<GenerateResult, LLMError>> {
    if (this.shouldFail) {
      return err(this.error);
    }
    return ok({
      content: this.response,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    });
  }

  setResponse(content: string): void {
    this.response = content;
  }

  setFailure(fail: boolean, error?: LLMError): void {
    this.shouldFail = fail;
    if (error) this.error = error;
  }
}

// Fake UserServiceClient
class FakeUserServiceClient implements UserServiceClient {
  private shouldFailLlm = false;
  private llmError: UserServiceError = {
    code: 'NO_API_KEY',
    message: 'No API key',
  };
  private llmClient: LlmGenerateClient = new FakeLlmClient();

  async getLlmClient(
    _userId: string
  ): Promise<Result<LlmGenerateClient, UserServiceError>> {
    if (this.shouldFailLlm) {
      return err(this.llmError);
    }
    return ok(this.llmClient);
  }

  // Minimal stubs for other methods
  async getApiKeys(_userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>> {
    return ok({} as DecryptedApiKeys);
  }

  async reportLlmSuccess(
    _userId: string,
    _provider: unknown
  ): Promise<void> {
    // Stub
  }

  async getOAuthToken(
    _userId: string,
    _provider: Google
  ): Promise<Result<OAuthTokenResult, UserServiceError>> {
    return ok({} as OAuthTokenResult);
  }

  setLlmFailure(fail: boolean, error?: UserServiceError): void {
    this.shouldFailLlm = fail;
    if (error) this.llmError = error;
  }

  getLlmClientRef(): LlmGenerateClient {
    return this.llmClient;
  }
}

describe('LinearActionExtractionService', () => {
  const mockLogger = pino({ level: 'silent' });

  let fakeUserService: FakeUserServiceClient;
  let fakeLlmClient: FakeLlmClient;
  let service: ReturnType<typeof createLinearActionExtractionService>;

  beforeEach(() => {
    fakeUserService = new FakeUserServiceClient();
    fakeLlmClient = fakeUserService.getLlmClientRef() as FakeLlmClient;
    service = createLinearActionExtractionService(fakeUserService, mockLogger);
  });

  const VALID_EXTRACTED_JSON = {
    title: 'Fix login bug',
    priority: 2,
    functionalRequirements: 'User should be able to login',
    technicalDetails: 'Check auth service',
    valid: true,
    error: null,
    reasoning: 'Issue extracted successfully',
  };

  describe('getLlmClient error paths', () => {
    it('returns NOT_CONNECTED when getLlmClient returns NO_API_KEY error', async () => {
      fakeUserService.setLlmFailure(true, {
        code: 'NO_API_KEY',
        message: 'No API key configured',
      });

      const result = await service.extractIssue('user-123', 'Create a bug report');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('No API key configured');
      }
    });

    it('returns INTERNAL_ERROR when getLlmClient returns other error codes', async () => {
      fakeUserService.setLlmFailure(true, {
        code: 'NETWORK_ERROR',
        message: 'Connection failed',
      });

      const result = await service.extractIssue('user-456', 'Some text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Connection failed');
      }
    });

    it('returns INTERNAL_ERROR for API_ERROR code', async () => {
      fakeUserService.setLlmFailure(true, {
        code: 'API_ERROR',
        message: 'User service unavailable',
      });

      const result = await service.extractIssue('user-789', 'Text');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('LLM generate error paths', () => {
    it('returns EXTRACTION_FAILED when LLM generate fails', async () => {
      fakeLlmClient.setFailure(true, {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
      });

      const result = await service.extractIssue('user-123', 'Extract this');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toBe('Too many requests');
      }
    });
  });

  describe('Response parsing - markdown unwrapping', () => {
    it('extracts JSON from markdown code block with json language identifier', async () => {
      const markdownWrapped = `\`\`\`json
${JSON.stringify(VALID_EXTRACTED_JSON)}
\`\`\``;
      fakeLlmClient.setResponse(markdownWrapped);

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix login bug');
        expect(result.value.priority).toBe(2);
        expect(result.value.functionalRequirements).toBe('User should be able to login');
      }
    });

    it('extracts JSON from markdown code block without language identifier', async () => {
      const markdownWrapped = `\`\`\`
${JSON.stringify(VALID_EXTRACTED_JSON)}
\`\`\``;
      fakeLlmClient.setResponse(markdownWrapped);

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix login bug');
      }
    });

    it('handles plain JSON response without markdown wrapping', async () => {
      const plainJson = JSON.stringify(VALID_EXTRACTED_JSON);
      fakeLlmClient.setResponse(plainJson);

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix login bug');
      }
    });

    it('handles JSON with leading/trailing whitespace', async () => {
      const whitespaceJson = `   ${JSON.stringify(VALID_EXTRACTED_JSON)}   `;
      fakeLlmClient.setResponse(whitespaceJson);

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Fix login bug');
      }
    });
  });

  describe('JSON parse failures', () => {
    it('returns EXTRACTION_FAILED for malformed JSON', async () => {
      fakeLlmClient.setResponse('{ this is not valid json }');

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('Failed to parse');
      }
    });

    it('returns EXTRACTION_FAILED for empty string', async () => {
      fakeLlmClient.setResponse('');

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
      }
    });

    it('returns EXTRACTION_FAILED for non-JSON text', async () => {
      fakeLlmClient.setResponse('This is just plain text, not JSON at all');

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
      }
    });
  });

  describe('Zod validation failures', () => {
    it('returns EXTRACTION_FAILED when JSON missing required fields', async () => {
      const invalidSchema = {
        // Missing 'title' field (required)
        priority: 2,
        valid: true,
        reasoning: 'Some reasoning',
      };
      fakeLlmClient.setResponse(JSON.stringify(invalidSchema));

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('invalid response format');
      }
    });

    it('returns EXTRACTION_FAILED when priority is invalid', async () => {
      const invalidPriority = {
        title: 'Test',
        priority: 999, // Invalid priority (should be 0-4)
        valid: true,
        reasoning: 'Test',
      };
      fakeLlmClient.setResponse(JSON.stringify(invalidPriority));

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
      }
    });

    it('returns EXTRACTION_FAILED for wrong type on valid field', async () => {
      const wrongType = {
        title: 'Test',
        priority: 'high', // Should be number
        valid: true,
        reasoning: 'Test',
      };
      fakeLlmClient.setResponse(JSON.stringify(wrongType));

      const result = await service.extractIssue('user-123', 'Parse this');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
      }
    });
  });

  describe('Happy path - successful extraction', () => {
    it('returns ExtractedIssueData for valid response with all fields', async () => {
      const fullData = {
        title: 'Add dark mode support',
        priority: 1,
        functionalRequirements: 'Add theme toggle to settings',
        technicalDetails: 'Use CSS variables for theming',
        valid: true,
        error: null,
        reasoning: 'Clear feature request',
      };
      fakeLlmClient.setResponse(JSON.stringify(fullData));

      const result = await service.extractIssue('user-123', 'Add dark mode');

      expect(result.ok).toBe(true);
      if (result.ok) {
        const extracted: ExtractedIssueData = result.value;
        expect(extracted.title).toBe('Add dark mode support');
        expect(extracted.priority).toBe(1);
        expect(extracted.functionalRequirements).toBe('Add theme toggle to settings');
        expect(extracted.technicalDetails).toBe('Use CSS variables for theming');
        expect(extracted.valid).toBe(true);
        expect(extracted.error).toBeNull();
        expect(extracted.reasoning).toBe('Clear feature request');
      }
    });

    it('handles optional null fields correctly', async () => {
      const minimalData = {
        title: 'Simple task',
        priority: 3,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'Basic extraction',
      };
      fakeLlmClient.setResponse(JSON.stringify(minimalData));

      const result = await service.extractIssue('user-123', 'Simple task');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.functionalRequirements).toBeNull();
        expect(result.value.technicalDetails).toBeNull();
      }
    });

    it('handles all priority levels (0-4)', async () => {
      const priorities: LinearPriority[] = [0, 1, 2, 3, 4];

      for (const priority of priorities) {
        const data = {
          title: `Priority ${priority} issue`,
          priority,
          functionalRequirements: null,
          technicalDetails: null,
          valid: true,
          error: null,
          reasoning: 'Test',
        };
        fakeLlmClient.setResponse(JSON.stringify(data));

        const result = await service.extractIssue('user-123', `Test ${priority}`);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.priority).toBe(priority);
        }
      }
    });

    it('handles valid=false with error message', async () => {
      const errorData = {
        title: 'Unclear request',
        priority: 0,
        functionalRequirements: null,
        technicalDetails: null,
        valid: false,
        error: 'User intent unclear - need more details',
        reasoning: 'Input lacks sufficient information',
      };
      fakeLlmClient.setResponse(JSON.stringify(errorData));

      const result = await service.extractIssue('user-123', 'do something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.valid).toBe(false);
        expect(result.value.error).toBe('User intent unclear - need more details');
        expect(result.value.reasoning).toBe('Input lacks sufficient information');
      }
    });
  });

  describe('Edge cases', () => {
    it('handles extra fields in JSON (Zod strips unknown fields)', async () => {
      const extraFields = {
        ...VALID_EXTRACTED_JSON,
        extraField: 'should be ignored',
        anotherExtra: 123,
      };
      fakeLlmClient.setResponse(JSON.stringify(extraFields));

      const result = await service.extractIssue('user-123', 'Test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // @ts-expect-error - Testing that extra fields are stripped
        expect(result.value.extraField).toBeUndefined();
      }
    });

    it('handles whitespace-only content before code block', async () => {
      const content = `   \n\n\`\`\`json
${JSON.stringify(VALID_EXTRACTED_JSON)}
\`\`\``;
      fakeLlmClient.setResponse(content);

      const result = await service.extractIssue('user-123', 'Test');

      expect(result.ok).toBe(true);
    });

    it('handles malformed markdown with partial code block', async () => {
      // Only opening ``` with no closing - should fail JSON parsing
      const partialMarkdown = `\`\`\`json
${JSON.stringify(VALID_EXTRACTED_JSON)}`;
      fakeLlmClient.setResponse(partialMarkdown);

      const result = await service.extractIssue('user-123', 'Test');

      // Should fail JSON parsing since the regex won't match and content has ```json\n prefix
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EXTRACTION_FAILED');
        expect(result.error.message).toContain('Failed to parse');
      }
    });
  });
});
