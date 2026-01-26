/**
 * Tests for approval intent prompt and response parsing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import {
  approvalIntentPrompt,
  parseApprovalIntentResponse,
  parseApprovalIntentResponseWithLogging,
} from '../approvalIntentPrompt.js';

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

  it('extracts JSON from markdown code block', () => {
    const response = '```json\n{"intent": "approve", "confidence": 0.9, "reasoning": "Test"}\n```';
    const result = parseApprovalIntentResponse(response);

    expect(result).toEqual({
      intent: 'approve',
      confidence: 0.9,
      reasoning: 'Test',
    });
  });

  it('extracts JSON from plain code block', () => {
    const response = '```\n{"intent": "reject", "confidence": 0.7, "reasoning": "Test"}\n```';
    const result = parseApprovalIntentResponse(response);

    expect(result).toEqual({
      intent: 'reject',
      confidence: 0.7,
      reasoning: 'Test',
    });
  });

  it('returns null for invalid JSON', () => {
    const response = 'not valid json';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for invalid intent value', () => {
    const response = '{"intent": "maybe", "confidence": 0.5, "reasoning": "Test"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for invalid confidence value', () => {
    const response = '{"intent": "approve", "confidence": "high", "reasoning": "Test"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for confidence out of range', () => {
    const response = '{"intent": "approve", "confidence": 1.5, "reasoning": "Test"}';
    const result = parseApprovalIntentResponse(response);

    expect(result).toBeNull();
  });

  it('returns null for missing required fields', () => {
    const response = '{"intent": "approve", "confidence": 0.9}';
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
      level: 'silent',
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      msgPrefix: '',
    } as unknown as Logger;
  });

  it('returns parsed result without logging on success', () => {
    const response = '{"intent": "approve", "confidence": 0.9, "reasoning": "User said yes"}';
    const result = parseApprovalIntentResponseWithLogging(response, mockLogger);

    expect(result).toEqual({
      intent: 'approve',
      confidence: 0.9,
      reasoning: 'User said yes',
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('logs warning when parsing fails', () => {
    const response = 'invalid json';
    const result = parseApprovalIntentResponseWithLogging(response, mockLogger);

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        rawResponse: 'invalid json',
      }),
      expect.stringContaining('Failed to parse')
    );
  });

  it('logs warning with truncated response for long inputs', () => {
    const longResponse = 'x'.repeat(300);
    const result = parseApprovalIntentResponseWithLogging(longResponse, mockLogger);

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        rawResponse: expect.stringMatching(/x{200}\.\.\.$/),
      }),
      expect.any(String)
    );
  });
});
