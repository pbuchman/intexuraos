/**
 * Tests for LLM audit logging.
 * Mocks @intexuraos/infra-firestore.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDocSet = vi.fn().mockResolvedValue(undefined);
const mockCollectionDoc = vi.fn().mockReturnValue({ set: mockDocSet });
const mockCollection = vi.fn().mockReturnValue({ doc: mockCollectionDoc });
const mockGetFirestore = vi.fn().mockReturnValue({ collection: mockCollection });

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: mockGetFirestore,
}));

const { createAuditContext, isAuditEnabled } = await import('../audit.js');

describe('isAuditEnabled', () => {
  const originalEnv = process.env['INTEXURAOS_AUDIT_LLMS'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['INTEXURAOS_AUDIT_LLMS'];
    } else {
      process.env['INTEXURAOS_AUDIT_LLMS'] = originalEnv;
    }
  });

  it('returns true when env var is not set', () => {
    delete process.env['INTEXURAOS_AUDIT_LLMS'];
    expect(isAuditEnabled()).toBe(true);
  });

  it('returns true when env var is empty string', () => {
    process.env['INTEXURAOS_AUDIT_LLMS'] = '';
    expect(isAuditEnabled()).toBe(true);
  });

  it('returns true when env var is "true"', () => {
    process.env['INTEXURAOS_AUDIT_LLMS'] = 'true';
    expect(isAuditEnabled()).toBe(true);
  });

  it('returns true when env var is "1"', () => {
    process.env['INTEXURAOS_AUDIT_LLMS'] = '1';
    expect(isAuditEnabled()).toBe(true);
  });

  it('returns true when env var is "yes"', () => {
    process.env['INTEXURAOS_AUDIT_LLMS'] = 'yes';
    expect(isAuditEnabled()).toBe(true);
  });

  it('returns false when env var is "false"', () => {
    process.env['INTEXURAOS_AUDIT_LLMS'] = 'false';
    expect(isAuditEnabled()).toBe(false);
  });

  it('returns false when env var is "0"', () => {
    process.env['INTEXURAOS_AUDIT_LLMS'] = '0';
    expect(isAuditEnabled()).toBe(false);
  });

  it('returns false when env var is "no"', () => {
    process.env['INTEXURAOS_AUDIT_LLMS'] = 'no';
    expect(isAuditEnabled()).toBe(false);
  });

  it('returns false when env var is "FALSE" (case insensitive)', () => {
    process.env['INTEXURAOS_AUDIT_LLMS'] = 'FALSE';
    expect(isAuditEnabled()).toBe(false);
  });
});

describe('createAuditContext', () => {
  const originalEnv = process.env['INTEXURAOS_AUDIT_LLMS'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['INTEXURAOS_AUDIT_LLMS'];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['INTEXURAOS_AUDIT_LLMS'];
    } else {
      process.env['INTEXURAOS_AUDIT_LLMS'] = originalEnv;
    }
  });

  describe('success', () => {
    it('saves audit log to Firestore on success', async () => {
      const startedAt = new Date('2024-01-01T00:00:00Z');
      const ctx = createAuditContext({
        provider: 'openai',
        model: 'gpt-4',
        method: 'research',
        prompt: 'Test prompt',
        startedAt,
      });

      await ctx.success({ response: 'Test response' });

      expect(mockCollection).toHaveBeenCalledWith('llm_api_logs');
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4',
          method: 'research',
          prompt: 'Test prompt',
          promptLength: 11,
          status: 'success',
          response: 'Test response',
          responseLength: 13,
          startedAt: '2024-01-01T00:00:00.000Z',
        })
      );
    });

    it('includes userId when provided', async () => {
      const ctx = createAuditContext({
        provider: 'anthropic',
        model: 'claude-3',
        method: 'generate',
        prompt: 'Test',
        startedAt: new Date(),
        userId: 'user-123',
      });

      await ctx.success({ response: 'Response' });

      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
        })
      );
    });

    it('includes researchId when provided', async () => {
      const ctx = createAuditContext({
        provider: 'google',
        model: 'gemini',
        method: 'synthesize',
        prompt: 'Test',
        startedAt: new Date(),
        researchId: 'research-456',
      });

      await ctx.success({ response: 'Response' });

      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          researchId: 'research-456',
        })
      );
    });

    it('does not save log when audit is disabled', async () => {
      process.env['INTEXURAOS_AUDIT_LLMS'] = 'false';

      const ctx = createAuditContext({
        provider: 'openai',
        model: 'gpt-4',
        method: 'research',
        prompt: 'Test',
        startedAt: new Date(),
      });

      await ctx.success({ response: 'Response' });

      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('is idempotent - only logs once', async () => {
      const ctx = createAuditContext({
        provider: 'openai',
        model: 'gpt-4',
        method: 'research',
        prompt: 'Test',
        startedAt: new Date(),
      });

      await ctx.success({ response: 'Response 1' });
      await ctx.success({ response: 'Response 2' });

      expect(mockDocSet).toHaveBeenCalledTimes(1);
    });

    it('calculates duration correctly', async () => {
      const startedAt = new Date('2024-01-01T00:00:00.000Z');

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:01.500Z'));

      const ctx = createAuditContext({
        provider: 'openai',
        model: 'gpt-4',
        method: 'research',
        prompt: 'Test',
        startedAt,
      });

      await ctx.success({ response: 'Response' });

      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: 1500,
        })
      );

      vi.useRealTimers();
    });
  });

  describe('error', () => {
    it('saves error log to Firestore', async () => {
      const startedAt = new Date('2024-01-01T00:00:00Z');
      const ctx = createAuditContext({
        provider: 'openai',
        model: 'gpt-4',
        method: 'research',
        prompt: 'Test prompt',
        startedAt,
      });

      await ctx.error({ error: 'API request failed' });

      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4',
          method: 'research',
          prompt: 'Test prompt',
          promptLength: 11,
          status: 'error',
          error: 'API request failed',
          startedAt: '2024-01-01T00:00:00.000Z',
        })
      );
    });

    it('includes optional fields when provided', async () => {
      const ctx = createAuditContext({
        provider: 'anthropic',
        model: 'claude-3',
        method: 'generate',
        prompt: 'Test',
        startedAt: new Date(),
        userId: 'user-123',
        researchId: 'research-456',
      });

      await ctx.error({ error: 'Error' });

      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          researchId: 'research-456',
        })
      );
    });

    it('does not save log when audit is disabled', async () => {
      process.env['INTEXURAOS_AUDIT_LLMS'] = 'false';

      const ctx = createAuditContext({
        provider: 'openai',
        model: 'gpt-4',
        method: 'research',
        prompt: 'Test',
        startedAt: new Date(),
      });

      await ctx.error({ error: 'Error' });

      expect(mockDocSet).not.toHaveBeenCalled();
    });

    it('is idempotent - only logs once', async () => {
      const ctx = createAuditContext({
        provider: 'openai',
        model: 'gpt-4',
        method: 'research',
        prompt: 'Test',
        startedAt: new Date(),
      });

      await ctx.error({ error: 'Error 1' });
      await ctx.error({ error: 'Error 2' });

      expect(mockDocSet).toHaveBeenCalledTimes(1);
    });

    it('does not log if success was called first', async () => {
      const ctx = createAuditContext({
        provider: 'openai',
        model: 'gpt-4',
        method: 'research',
        prompt: 'Test',
        startedAt: new Date(),
      });

      await ctx.success({ response: 'Response' });
      await ctx.error({ error: 'Error' });

      expect(mockDocSet).toHaveBeenCalledTimes(1);
      expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
    });
  });

  describe('Firestore error handling', () => {
    it('catches and logs Firestore errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockDocSet.mockRejectedValueOnce(new Error('Firestore connection failed'));

      const ctx = createAuditContext({
        provider: 'openai',
        model: 'gpt-4',
        method: 'research',
        prompt: 'Test',
        startedAt: new Date(),
      });

      await ctx.success({ response: 'Response' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save LLM audit log')
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
