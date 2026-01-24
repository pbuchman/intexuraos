import { describe, it, expect } from 'vitest';
import { formatLlmError } from '../../../domain/settings/formatLlmError.js';

describe('formatLlmError', () => {
  describe('Anthropic errors', () => {
    it('returns user-friendly message for credit balance billing error', () => {
      const rawError =
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
      const result = formatLlmError(rawError);
      expect(result).toBe('Insufficient Anthropic API credits. Please add funds at console.anthropic.com');
    });

    it('detects credit balance error without JSON wrapper', () => {
      const rawError = 'credit balance is too low';
      const result = formatLlmError(rawError);
      expect(result).toBe('Insufficient Anthropic API credits. Please add funds at console.anthropic.com');
    });

    it('detects credit_balance underscore variant', () => {
      const rawError = 'credit_balance is insufficient';
      const result = formatLlmError(rawError);
      expect(result).toBe('Insufficient Anthropic API credits. Please add funds at console.anthropic.com');
    });

    it('extracts message from Anthropic JSON error format for non-billing errors', () => {
      const rawError =
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Invalid request body"}}';
      const result = formatLlmError(rawError);
      expect(result).toBe('Invalid request body');
    });

    it('truncates long Anthropic messages', () => {
      const longMessage = 'A'.repeat(200);
      const rawError = `{"type":"error","error":{"type":"invalid_request_error","message":"${longMessage}"}}`;
      const result = formatLlmError(rawError);
      expect(result).toHaveLength(150); // 147 chars + "..."
      expect(result).toContain('...');
    });

    it('handles rate_limit in string format', () => {
      const result = formatLlmError('rate_limit exceeded');
      expect(result).toBe('Anthropic API rate limit reached');
    });

    it('handles overloaded error', () => {
      const result = formatLlmError('The service is overloaded');
      expect(result).toBe('Anthropic API is temporarily overloaded');
    });

    it('handles 429 with anthropic in error string', () => {
      const result = formatLlmError('429 anthropic api error');
      expect(result).toBe('Anthropic API rate limit reached');
    });

    it('detects credit_balance error inside parsed JSON message', () => {
      // This tests the branch at line 167-168: message.includes('credit_balance')
      // The message itself contains credit_balance, triggering the inner check
      const rawError =
        '400 {"type":"error","error":{"type":"billing_error","message":"Your credit_balance is insufficient"}}';
      const result = formatLlmError(rawError);
      expect(result).toBe('Insufficient Anthropic API credits. Please add funds at console.anthropic.com');
    });

    it('falls through when JSON has type:error but is not valid Anthropic error structure', () => {
      const rawError = '{"type":"error","error":"string not object"}';
      const result = formatLlmError(rawError);
      expect(result).toBe('{"type":"error","error":"string not object"}');
    });
  });

  describe('Google/Gemini errors', () => {
    it('extracts message from Gemini invalid API key error', () => {
      const rawError = JSON.stringify({
        error: {
          code: 400,
          message: 'API key not valid',
          status: 'INVALID_ARGUMENT',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'API_KEY_INVALID',
            },
          ],
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('API key not valid');
    });

    it('handles API_KEY_NOT_FOUND error', () => {
      const rawError = JSON.stringify({
        error: {
          code: 400,
          message: 'API key does not exist',
          status: 'INVALID_ARGUMENT',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'API_KEY_NOT_FOUND',
            },
          ],
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('API key does not exist');
    });

    it('uses fallback when API_KEY_INVALID has empty displayMessage', () => {
      const rawError = JSON.stringify({
        error: {
          code: 400,
          message: '',
          status: 'INVALID_ARGUMENT',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'API_KEY_INVALID',
            },
          ],
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('The API key is invalid or has expired');
    });

    it('uses fallback when API_KEY_NOT_FOUND has empty displayMessage', () => {
      const rawError = JSON.stringify({
        error: {
          code: 400,
          message: '',
          status: 'INVALID_ARGUMENT',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'API_KEY_NOT_FOUND',
            },
          ],
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('The API key does not exist');
    });

    it('uses fallback when PERMISSION_DENIED has empty displayMessage', () => {
      const rawError = JSON.stringify({
        error: {
          code: 403,
          message: '',
          status: 'PERMISSION_DENIED',
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('The API key lacks required permissions');
    });

    it('handles PERMISSION_DENIED error with status', () => {
      const rawError = JSON.stringify({
        error: {
          code: 403,
          message: 'Permission denied',
          status: 'PERMISSION_DENIED',
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('Permission denied');
    });

    it('handles 403 code without status', () => {
      const rawError = JSON.stringify({
        error: {
          code: 403,
          message: 'Forbidden',
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('Forbidden');
    });

    it('handles quota exceeded error', () => {
      const rawError = JSON.stringify({
        error: {
          code: 429,
          message: 'Quota exceeded',
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [{ quotaValue: '1000' }],
            },
          ],
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('Quota: 1000 tokens/min');
    });

    it('uses unknown fallback when quotaValue is missing', () => {
      const rawError = JSON.stringify({
        error: {
          code: 429,
          message: 'Quota exceeded',
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [{}],
            },
          ],
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('Quota: unknown tokens/min');
    });

    it('handles quota exceeded without violation details', () => {
      const rawError = JSON.stringify({
        error: {
          status: 'RESOURCE_EXHAUSTED',
          message: 'Quota temporarily exceeded',
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('API quota temporarily exceeded');
    });

    it('handles INVALID_ARGUMENT with message', () => {
      const rawError = JSON.stringify({
        error: {
          status: 'INVALID_ARGUMENT',
          message: 'Invalid model parameter',
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('Invalid model parameter');
    });

    it('handles INVALID_ARGUMENT without message', () => {
      const rawError = JSON.stringify({
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: '',
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('The request was invalid');
    });

    it('returns short displayMessage directly', () => {
      const rawError = JSON.stringify({
        error: {
          message: 'Short error',
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('Short error');
    });

    it('returns fallback for long displayMessage', () => {
      const longMessage = 'A'.repeat(200);
      const rawError = JSON.stringify({
        error: {
          message: longMessage,
        },
      });
      const result = formatLlmError(rawError);
      expect(result).toBe('An error occurred with the Gemini API');
    });

    it('falls through when JSON has error/message strings but parsed.error is undefined', () => {
      // JSON passes string checks ("error" and "message" in string) but parsed.error === undefined
      // This hits line 79 (return null) then falls through to generic error which returns raw string
      const rawError = '{"data": {"error": "nested"}, "message": "test"}';
      const result = formatLlmError(rawError);
      expect(result).toBe(rawError);
    });

    it('handles malformed JSON that passes initial string checks', () => {
      const rawError = '{"error": {"message": "incomplete json"';
      const result = formatLlmError(rawError);
      expect(result).toBeTruthy();
      expect(result).toContain('incomplete json');
    });
  });

  describe('OpenAI errors', () => {
    it('extracts details from OpenAI rate limit error', () => {
      const rawError =
        '429 Rate limit reached for default in organization org-123 on tokens: Limit 90000, Used 85000, Requested 10000. Please try again in 15s.';
      const result = formatLlmError(rawError);
      expect(result).toContain('tokens: 85000/90000');
      expect(result).toContain('need 10000 more');
    });

    it('handles quota exceeded', () => {
      const result = formatLlmError('You exceeded your current quota');
      expect(result).toBe('OpenAI API quota exceeded. Check billing.');
    });

    it('handles context length exceeded', () => {
      const result = formatLlmError('context_length_exceeded');
      expect(result).toBe("The request exceeds the model's context limit");
    });

    it('handles maximum context length', () => {
      const result = formatLlmError('This model maximum context length is 4096 tokens');
      expect(result).toBe("The request exceeds the model's context limit");
    });
  });

  describe('Generic errors', () => {
    it('handles API key errors', () => {
      const result = formatLlmError('invalid api_key provided');
      expect(result).toBe('The API key for this provider is invalid or expired');
    });

    it('handles invalid key errors', () => {
      const result = formatLlmError('Invalid key format');
      expect(result).toBe('The API key for this provider is invalid or expired');
    });

    it('handles timeout errors', () => {
      const result = formatLlmError('Request timeout after 30s');
      expect(result).toBe('The API request took too long to respond');
    });

    it('handles network errors', () => {
      const result = formatLlmError('Network connection failed');
      expect(result).toBe('Could not connect to the API');
    });

    it('handles connection errors', () => {
      const result = formatLlmError('Connection refused by server');
      expect(result).toBe('Could not connect to the API');
    });

    it('truncates very long error messages', () => {
      const longError = 'Error: ' + 'X'.repeat(200);
      const result = formatLlmError(longError);
      expect(result).toHaveLength(83); // 80 chars + "..."
      expect(result).toContain('...');
    });

    it('returns short errors as-is', () => {
      const result = formatLlmError('Short error');
      expect(result).toBe('Short error');
    });
  });
});
