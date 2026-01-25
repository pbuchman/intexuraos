import { beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { ZodError } from 'zod';
import {
  createLlmParseError,
  logLlmParseError,
  withLlmParseErrorLogging,
  createDetailedParseErrorMessage,
  formatZodErrors,
  type LlmParseErrorDetails,
} from '../parseError.js';

const mockLogger = pino({ level: 'silent' });

describe('parseError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('truncate (internal via createLlmParseError)', () => {
    it('returns original string when length is within limit', () => {
      const shortResponse = 'This is a short response';
      const result = createLlmParseError({
        errorMessage: 'Parse failed',
        llmResponse: shortResponse,
        expectedSchema: 'MySchema',
        operation: 'testOp',
      });

      expect(result.llmResponse).toBe(shortResponse);
    });

    it('truncates string when length exceeds default limit of 1000', () => {
      const longResponse = 'x'.repeat(1500);
      const result = createLlmParseError({
        errorMessage: 'Parse failed',
        llmResponse: longResponse,
        expectedSchema: 'MySchema',
        operation: 'testOp',
      });

      // 1000 chars + '... [truncated, original length: 1500]' (38 chars)
      expect(result.llmResponse).toHaveLength(1038);
      expect(result.llmResponse).toContain('... [truncated, original length: 1500]');
      expect(result.llmResponse).not.toContain(longResponse);
    });

    it('truncates prompt when provided and exceeds 500 limit', () => {
      const longPrompt = 'y'.repeat(1000);
      const result = createLlmParseError({
        errorMessage: 'Parse failed',
        llmResponse: 'response',
        expectedSchema: 'MySchema',
        operation: 'testOp',
        prompt: longPrompt,
      });

      // 500 chars + '... [truncated, original length: 1000]' (38 chars)
      expect(result.prompt).toHaveLength(538);
      expect(result.prompt).toContain('... [truncated, original length: 1000]');
    });
  });

  describe('createLlmParseError', () => {
    it('creates error details with all required fields', () => {
      const result = createLlmParseError({
        errorMessage: 'Invalid JSON',
        llmResponse: '{"bad": json}',
        expectedSchema: 'Valid JSON object',
        operation: 'parseUserSettings',
      });

      expect(result).toEqual({
        errorMessage: 'Invalid JSON',
        llmResponse: '{"bad": json}',
        expectedSchema: 'Valid JSON object',
        operation: 'parseUserSettings',
      });
      expect(result.prompt).toBeUndefined();
    });

    it('includes prompt when provided', () => {
      const prompt = 'Extract user settings from this text';
      const result = createLlmParseError({
        errorMessage: 'Parse failed',
        llmResponse: 'bad response',
        expectedSchema: 'Schema',
        operation: 'test',
        prompt,
      });

      expect(result.prompt).toBe(prompt);
    });

    it('excludes prompt field when undefined', () => {
      const result = createLlmParseError({
        errorMessage: 'Parse failed',
        llmResponse: 'response',
        expectedSchema: 'Schema',
        operation: 'test',
      });

      expect(result).not.toHaveProperty('prompt');
    });
  });

  describe('logLlmParseError', () => {
    it('logs parse error with all fields', () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');

      const details: LlmParseErrorDetails = {
        errorMessage: 'Invalid format',
        llmResponse: 'bad response',
        expectedSchema: 'Expected format',
        operation: 'parseTodo',
      };

      logLlmParseError(logger, details);

      expect(warnSpy).toHaveBeenCalledWith(
        {
          operation: 'parseTodo',
          errorMessage: 'Invalid format',
          llmResponse: 'bad response',
          expectedSchema: 'Expected format',
          responseLength: 12, // 'bad response' has 12 characters
        },
        'LLM parse error in parseTodo: Invalid format'
      );
    });

    it('includes prompt in log when provided', () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');

      const details: LlmParseErrorDetails = {
        errorMessage: 'Failed',
        llmResponse: 'response',
        expectedSchema: 'Schema',
        operation: 'test',
        prompt: 'The prompt',
      };

      logLlmParseError(logger, details);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'The prompt' }),
        expect.stringContaining('LLM parse error in test: Failed')
      );
    });
  });

  describe('withLlmParseErrorLogging', () => {
    it('returns parser result when parsing succeeds', () => {
      const parser = vi.fn(() => ({ result: 'success' }));
      const wrapped = withLlmParseErrorLogging({
        logger: mockLogger,
        operation: 'parseTest',
        expectedSchema: 'TestSchema',
        parser,
      });

      const result = wrapped('input');

      expect(parser).toHaveBeenCalledWith('input');
      expect(result).toEqual({ result: 'success' });
    });

    it('logs and re-throws when parser throws', () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');
      const parser = vi.fn(() => {
        throw new Error('Parse error occurred');
      });

      const wrapped = withLlmParseErrorLogging({
        logger,
        operation: 'parseTest',
        expectedSchema: 'TestSchema',
        parser,
      });

      expect(() => wrapped('test input')).toThrow('Parse error occurred');
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
        operation: 'parseTest',
        errorMessage: 'Parse error occurred',
        llmResponse: 'test input',
        expectedSchema: 'TestSchema',
        responseLength: 10,
      });
    });

    it('includes prompt in error details when getPrompt is provided', () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');
      const parser = vi.fn(() => {
        throw new Error('Failed');
      });

      const wrapped = withLlmParseErrorLogging({
        logger,
        operation: 'parseTest',
        expectedSchema: 'TestSchema',
        parser,
        getPrompt: () => 'The prompt was this',
      });

      expect(() => wrapped('input')).toThrow('Failed');
      expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
        operation: 'parseTest',
        errorMessage: 'Failed',
        llmResponse: 'input',
        expectedSchema: 'TestSchema',
        prompt: 'The prompt was this',
        responseLength: 5,
      });
    });

    it('does not include prompt in error details when getPrompt is not provided', () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');
      const parser = vi.fn(() => {
        throw new Error('Failed');
      });

      const wrapped = withLlmParseErrorLogging({
        logger,
        operation: 'parseTest',
        expectedSchema: 'TestSchema',
        parser,
      });

      expect(() => wrapped('input')).toThrow('Failed');
      expect(warnSpy.mock.calls[0]?.[0]).not.toHaveProperty('prompt');
      expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
        operation: 'parseTest',
        errorMessage: 'Failed',
        llmResponse: 'input',
        expectedSchema: 'TestSchema',
        responseLength: 5,
      });
    });
  });

  describe('createDetailedParseErrorMessage', () => {
    it('creates detailed error message with all components', () => {
      const result = createDetailedParseErrorMessage({
        errorMessage: 'Invalid JSON structure',
        llmResponse: '{"incomplete": json',
        expectedSchema: 'Valid JSON object with all required fields',
        operation: 'parseUserSettings',
      });

      expect(result).toBe(
        'Invalid JSON structure\n\nExpected: Valid JSON object with all required fields\n\nReceived (first 500 chars):\n{"incomplete": json'
      );
    });

    it('truncates long response to 500 characters', () => {
      const longResponse = 'x'.repeat(1000);
      const result = createDetailedParseErrorMessage({
        errorMessage: 'Failed',
        llmResponse: longResponse,
        expectedSchema: 'Schema',
        operation: 'test',
      });

      // Should be 500 chars + '... [truncated, original length: 1000]' + header text
      expect(result).toContain('... [truncated, original length: 1000]');
    });

    it('includes short response without truncation', () => {
      const shortResponse = 'OK';
      const result = createDetailedParseErrorMessage({
        errorMessage: 'Failed',
        llmResponse: shortResponse,
        expectedSchema: 'Schema',
        operation: 'test',
      });

      expect(result).toContain('OK');
      expect(result).not.toContain('[truncated');
    });
  });

  describe('formatZodErrors', () => {
    it('formats single error with field path', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          path: ['quality'],
          expected: 'number',
          received: 'string',
          message: 'Expected number, received string',
        },
      ]);

      const result = formatZodErrors(zodError);
      expect(result).toBe('quality: expected number, received "string"');
    });

    it('formats invalid enum value errors', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_enum_value',
          path: ['priority'],
          options: ['low', 'medium', 'high'],
          received: 'urgent',
          message: 'Invalid enum value',
        } as never,
      ]);

      const result = formatZodErrors(zodError);
      expect(result).toBe("priority: expected 'low' | 'medium' | 'high', received \"urgent\"");
    });

    it('formats invalid union errors', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_union',
          path: ['mode'],
          unionErrors: [
            new ZodError([
              {
                code: 'invalid_enum_value',
                path: ['mode'],
                options: ['compact', 'standard'],
                received: 'deep',
              },
            ] as never),
          ],
          message: 'Invalid union value',
        } as never,
      ]);

      const result = formatZodErrors(zodError);
      expect(result).toBe('mode: Invalid union value');
    });

    it('formats multiple errors separated by semicolon', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          path: ['quality'],
          expected: 'number',
          received: 'string',
          message: 'Expected number',
        },
        {
          code: 'invalid_type',
          path: ['reason'],
          expected: 'string',
          received: 'number',
          message: 'Expected string',
        },
      ]);

      const result = formatZodErrors(zodError);
      expect(result).toBe(
        'quality: expected number, received "string"; reason: expected string, received "number"'
      );
    });

    it('formats root path errors as (root)', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          path: [],
          expected: 'object',
          received: 'string',
          message: 'Expected object',
        },
      ]);

      const result = formatZodErrors(zodError);
      expect(result).toBe('(root): expected object, received "string"');
    });

    it('limits output to 5 issues and adds count for remaining', () => {
      const issues = Array.from({ length: 10 }, (_, i) => ({
        code: 'invalid_type' as const,
        path: [`field${i}`],
        expected: 'string' as const,
        received: 'number' as const,
        message: `Field ${i} error`,
      })) as never[];

      const zodError = new ZodError(issues);
      const result = formatZodErrors(zodError);

      expect(result).toContain('... (+5 more)');
      // Should have first 5 errors
      expect(result).toContain('field0');
      expect(result).toContain('field4');
      // Should not have errors beyond 5
      expect(result).not.toContain('field5');
      expect(result).not.toContain('field9');
    });

    it('returns message for unknown error codes', () => {
      const zodError = new ZodError([
        {
          code: 'custom' as never,
          path: ['field'],
          message: 'Custom validation failed',
        },
      ]);

      const result = formatZodErrors(zodError);
      expect(result).toBe('field: Custom validation failed');
    });

    it('returns special message for empty issues array', () => {
      const zodError = new ZodError([]);
      const result = formatZodErrors(zodError);
      expect(result).toBe('Unknown validation error (no issues reported)');
    });

    it('handles nested field paths', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          path: ['user', 'age'],
          expected: 'number',
          received: 'string',
          message: 'Expected number',
        },
      ]);

      const result = formatZodErrors(zodError);
      expect(result).toBe('user.age: expected number, received "string"');
    });

    it('handles array index paths', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          path: ['items', 0, 'title'],
          expected: 'string',
          received: 'number',
          message: 'Expected string',
        },
      ]);

      const result = formatZodErrors(zodError);
      expect(result).toBe('items.0.title: expected string, received "number"');
    });
  });
});
