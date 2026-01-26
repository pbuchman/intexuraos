/**
 * Tests for approval intent prompt and response parsing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  approvalIntentPrompt,
  parseApprovalIntentResponse,
  parseApprovalIntentResponseWithLogging,
} from '../approvalIntentPrompt.js';
import type { Logger } from 'pino';

describe('approvalIntentPrompt', () => {
  it('builds prompt with user reply', () => {
    const prompt = approvalIntentPrompt({ input: { userReply: 'yes please' } });

    expect(prompt).toContain('yes please');
    expect(prompt).toContain('User replied:');
  });

  it('includes approve intent examples', () => {
    const prompt = approvalIntentPrompt({ input: { userReply: 'test' } });

    expect(prompt).toContain('"approve"');
    expect(prompt).toContain('yes');
    expect(prompt).toContain('ok');
    expect(prompt).toContain('go ahead');
  });

  it('includes reject intent examples', () => {
    const prompt = approvalIntentPrompt({ input: { userReply: 'test' } });

    expect(prompt).toContain('"reject"');
    expect(prompt).toContain('no');
    expect(prompt).toContain('cancel');
    expect(prompt).toContain('stop');
  });

  it('includes unclear intent examples', () => {
    const prompt = approvalIntentPrompt({ input: { userReply: 'test' } });

    expect(prompt).toContain('"unclear"');
    expect(prompt).toContain('ambiguous');
  });

  it('includes emoji guidance', () => {
    const prompt = approvalIntentPrompt({ input: { userReply: 'test' } });

    expect(prompt).toContain('Emojis count');
  });

  it('includes JSON format instructions', () => {
    const prompt = approvalIntentPrompt({ input: { userReply: 'test' } });

    expect(prompt).toContain('Respond with ONLY valid JSON');
    expect(prompt).toContain('"intent"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"reasoning"');
  });
});

describe('parseApprovalIntentResponse', () => {
  it('parses valid approve response', () => {
    const response = '{"intent": "approve", "confidence": 0.95, "reasoning": "User said yes"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toEqual({
      intent: 'approve',
      confidence: 0.95,
      reasoning: 'User said yes',
    });
  });

  it('parses valid reject response', () => {
    const response = '{"intent": "reject", "confidence": 0.8, "reasoning": "User said no"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toEqual({
      intent: 'reject',
      confidence: 0.8,
      reasoning: 'User said no',
    });
  });

  it('parses valid unclear response', () => {
    const response = '{"intent": "unclear", "confidence": 0.5, "reasoning": "Ambiguous reply"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toEqual({
      intent: 'unclear',
      confidence: 0.5,
      reasoning: 'Ambiguous reply',
    });
  });

  it('extracts JSON from response with surrounding text', () => {
    const response = `Here is my analysis:
{"intent": "approve", "confidence": 0.9, "reasoning": "Clear yes"}
That's my classification.`;
    const result = parseApprovalIntentResponse(response);

    expect(result).toEqual({
      intent: 'approve',
      confidence: 0.9,
      reasoning: 'Clear yes',
    });
  });

  it('returns null for no JSON in response', () => {
    const response = 'This is just text without any JSON';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const response = '{"intent": "approve", "confidence": }';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for invalid intent value', () => {
    const response = '{"intent": "maybe", "confidence": 0.5, "reasoning": "test"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for confidence out of range (negative)', () => {
    const response = '{"intent": "approve", "confidence": -0.1, "reasoning": "test"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for confidence out of range (greater than 1)', () => {
    const response = '{"intent": "approve", "confidence": 1.5, "reasoning": "test"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for non-number confidence', () => {
    const response = '{"intent": "approve", "confidence": "high", "reasoning": "test"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for non-string reasoning', () => {
    const response = '{"intent": "approve", "confidence": 0.5, "reasoning": 123}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for missing intent field', () => {
    const response = '{"confidence": 0.5, "reasoning": "test"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for missing confidence field', () => {
    const response = '{"intent": "approve", "reasoning": "test"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for missing reasoning field', () => {
    const response = '{"intent": "approve", "confidence": 0.5}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for null parsed value', () => {
    const response = 'null';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for string primitive parsed value', () => {
    const response = '"just a string"';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for number primitive parsed value', () => {
    const response = '42';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for boolean primitive parsed value', () => {
    const response = 'true';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for array parsed value', () => {
    const response = '[1, 2, 3]';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('handles edge case of confidence exactly 0', () => {
    const response = '{"intent": "unclear", "confidence": 0, "reasoning": "no idea"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toEqual({
      intent: 'unclear',
      confidence: 0,
      reasoning: 'no idea',
    });
  });

  it('handles edge case of confidence exactly 1', () => {
    const response = '{"intent": "approve", "confidence": 1, "reasoning": "definitely yes"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toEqual({
      intent: 'approve',
      confidence: 1,
      reasoning: 'definitely yes',
    });
  });

  it('returns null for malformed JSON causing parse error', () => {
    const response = '{"intent": "approve", "confidence": }';

    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for JSON with syntax error', () => {
    const response = '{"intent": "approve",';

    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for JSON with trailing comma', () => {
    const response = '{"intent": "approve", "confidence": 0.5, "reasoning": "test",}';

    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for JSON with unquoted keys', () => {
    const response = '{intent: "approve", confidence: 0.5, reasoning: "test"}';

    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for response with only opening brace', () => {
    const response = '{';

    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for response with only opening bracket', () => {
    const response = '[';

    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for response with unclosed string', () => {
    const response = '{"intent": "approve", "confidence": 0.5, "reasoning": "test';

    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for NaN confidence value', () => {
    const response = '{"intent": "approve", "confidence": NaN, "reasoning": "test"}';

    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });
});

describe('parseApprovalIntentResponseWithLogging', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  it('returns parsed result when parsing succeeds', () => {
    const response = '{"intent": "approve", "confidence": 0.9, "reasoning": "User approved"}';

    const result = parseApprovalIntentResponseWithLogging(response, mockLogger);

    expect(result).toEqual({
      intent: 'approve',
      confidence: 0.9,
      reasoning: 'User approved',
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('throws and logs when parsing returns null', () => {
    const response = 'No JSON here';

    expect(() => parseApprovalIntentResponseWithLogging(response, mockLogger)).toThrow(
      'Failed to parse approval intent'
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'parseApprovalIntentResponse',
        errorMessage: 'Failed to parse approval intent: response does not match expected schema',
        llmResponse: response,
      }),
      expect.stringContaining('LLM parse error')
    );
  });

  it('throws and logs when JSON is malformed', () => {
    const response = '{"intent":"approve",invalid}';

    expect(() => parseApprovalIntentResponseWithLogging(response, mockLogger)).toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'parseApprovalIntentResponse',
        llmResponse: response,
      }),
      expect.stringContaining('LLM parse error')
    );
  });

  it('throws and logs when intent is invalid', () => {
    const response = '{"intent": "invalid", "confidence": 0.5, "reasoning": "test"}';

    expect(() => parseApprovalIntentResponseWithLogging(response, mockLogger)).toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'parseApprovalIntentResponse',
        llmResponse: response,
      }),
      expect.stringContaining('LLM parse error')
    );
  });

  it('throws and logs when confidence is out of range', () => {
    const response = '{"intent": "approve", "confidence": 2.0, "reasoning": "test"}';

    expect(() => parseApprovalIntentResponseWithLogging(response, mockLogger)).toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'parseApprovalIntentResponse',
        llmResponse: response,
      }),
      expect.stringContaining('LLM parse error')
    );
  });

  it('throws and logs when reasoning is not a string', () => {
    const response = '{"intent": "approve", "confidence": 0.5, "reasoning": 123}';

    expect(() => parseApprovalIntentResponseWithLogging(response, mockLogger)).toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'parseApprovalIntentResponse',
        llmResponse: response,
      }),
      expect.stringContaining('LLM parse error')
    );
  });

  it('returns parsed result for reject intent', () => {
    const response = '{"intent": "reject", "confidence": 0.8, "reasoning": "User said no"}';

    const result = parseApprovalIntentResponseWithLogging(response, mockLogger);

    expect(result).toEqual({
      intent: 'reject',
      confidence: 0.8,
      reasoning: 'User said no',
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns parsed result for unclear intent', () => {
    const response = '{"intent": "unclear", "confidence": 0.5, "reasoning": "Ambiguous"}';

    const result = parseApprovalIntentResponseWithLogging(response, mockLogger);

    expect(result).toEqual({
      intent: 'unclear',
      confidence: 0.5,
      reasoning: 'Ambiguous',
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
