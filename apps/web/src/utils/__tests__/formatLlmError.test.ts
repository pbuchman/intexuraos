import { describe, it, expect } from 'vitest';
import { formatLlmError, formatLlmErrorString } from '../formatLlmError';

describe('formatLlmError', () => {
  describe('Anthropic JSON errors', () => {
    it('parses authentication_error', () => {
      const raw =
        '401 {"type":"error","error":{"type":"authentication_error","message":"Invalid API key provided"}}';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Invalid API key');
      expect(result.detail).toBe('Invalid API key provided');
    });

    it('parses invalid_request_error', () => {
      const raw =
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Invalid request');
      expect(result.detail).toBe('Your credit balance is too low');
    });

    it('parses rate_limit_error', () => {
      const raw =
        '429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limit exceeded. Please retry after 60 seconds."}}';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Rate limit exceeded');
      expect(result.detail).toBe('Rate limit exceeded. Please retry after 60 seconds.');
    });

    it('parses overloaded_error', () => {
      const raw =
        '529 {"type":"error","error":{"type":"overloaded_error","message":"Anthropic is temporarily overloaded"}}';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Service overloaded');
      expect(result.detail).toBe('Anthropic is temporarily overloaded');
    });

    it('parses api_error', () => {
      const raw =
        '500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}';
      const result = formatLlmError(raw);
      expect(result.title).toBe('API error');
      expect(result.detail).toBe('Internal server error');
    });

    it('parses permission_error', () => {
      const raw =
        '403 {"type":"error","error":{"type":"permission_error","message":"You do not have access to this resource"}}';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Permission denied');
      expect(result.detail).toBe('You do not have access to this resource');
    });

    it('parses not_found_error', () => {
      const raw =
        '404 {"type":"error","error":{"type":"not_found_error","message":"The requested resource was not found"}}';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Not found');
      expect(result.detail).toBe('The requested resource was not found');
    });

    it('handles unknown error type', () => {
      const raw =
        '400 {"type":"error","error":{"type":"some_new_error","message":"Something unexpected"}}';
      const result = formatLlmError(raw);
      expect(result.title).toBe('API error');
      expect(result.detail).toBe('Something unexpected');
    });

    it('truncates long messages', () => {
      const longMessage = 'A'.repeat(200);
      const raw = `400 {"type":"error","error":{"type":"invalid_request_error","message":"${longMessage}"}}`;
      const result = formatLlmError(raw);
      expect(result.detail?.length).toBe(150);
      expect(result.detail?.endsWith('...')).toBe(true);
    });

    it('parses JSON without HTTP status prefix', () => {
      const raw =
        '{"type":"error","error":{"type":"authentication_error","message":"Invalid API key"}}';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Invalid API key');
      expect(result.detail).toBe('Invalid API key');
    });
  });

  describe('Anthropic string fallback', () => {
    it('handles rate_limit string pattern', () => {
      const raw = 'rate_limit exceeded';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Rate limit exceeded');
    });

    it('handles 429 with anthropic string pattern', () => {
      const raw = '429 anthropic rate limit';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Rate limit exceeded');
    });

    it('handles overloaded string pattern', () => {
      const raw = 'Service overloaded please try again';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Service overloaded');
    });
  });

  describe('OpenAI errors', () => {
    it('parses rate limit with retry info', () => {
      const raw =
        '429 Rate limit reached for gpt-4 in organization org-xxx on tokens per min: Limit 10000, Used 9500, Requested 1000. Please try again in 5s.';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Rate limit exceeded');
      expect(result.detail).toContain('9500/10000 used');
      expect(result.retryIn).toBe('Retry in 5s');
    });

    it('handles quota exceeded', () => {
      const raw = 'You exceeded your current quota';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Quota exceeded');
    });

    it('handles context length exceeded', () => {
      const raw = "context_length_exceeded: This model's maximum context length is 8192 tokens";
      const result = formatLlmError(raw);
      expect(result.title).toBe('Context too long');
    });
  });

  describe('generic errors', () => {
    it('handles api_key errors', () => {
      const raw = 'api_key is invalid';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Invalid API key');
    });

    it('handles timeout errors', () => {
      const raw = 'Request timeout after 30000ms';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Request timed out');
    });

    it('handles network errors', () => {
      const raw = 'Network error: Failed to fetch';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Connection error');
    });

    it('truncates long raw errors', () => {
      const raw = 'X'.repeat(150);
      const result = formatLlmError(raw);
      expect(result.title).toBe('API error');
      expect(result.detail?.length).toBe(83);
    });

    it('returns short errors as title', () => {
      const raw = 'Something went wrong';
      const result = formatLlmError(raw);
      expect(result.title).toBe('Something went wrong');
      expect(result.detail).toBeUndefined();
    });
  });
});

describe('formatLlmErrorString', () => {
  it('combines title and detail', () => {
    const raw =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Bad request"}}';
    const result = formatLlmErrorString(raw);
    expect(result).toBe('Invalid request — Bad request');
  });

  it('includes retry info', () => {
    const raw =
      '429 Rate limit reached for gpt-4 in organization org-xxx on tokens per min: Limit 10000, Used 9500, Requested 1000. Please try again in 5s.';
    const result = formatLlmErrorString(raw);
    expect(result).toContain('Rate limit exceeded');
    expect(result).toContain('Retry in 5s');
  });

  it('handles title-only errors', () => {
    const raw = 'Short error';
    const result = formatLlmErrorString(raw);
    expect(result).toBe('Short error');
  });
});
