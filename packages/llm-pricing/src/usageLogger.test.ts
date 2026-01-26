/**
 * Tests for LLM Usage Logger.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageLogger, isUsageLoggingEnabled, logUsage } from './usageLogger.js';
import type { CallType, UsageLogParams } from './usageLogger.js';
import type { Logger } from '@intexuraos/common-core';
import { LlmProviders, LlmModels } from '@intexuraos/llm-contract';

// Mock Firestore before importing
vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            collection: vi.fn(() => ({
              doc: vi.fn(),
            })),
          })),
        })),
      })),
    })),
    batch: vi.fn(() => ({
      set: vi.fn(),
      commit: vi.fn(),
    })),
    runTransaction: vi.fn(),
  })),
  FieldValue: {
    increment: vi.fn((val: number) => ({ __increment__: val })),
  },
}));

describe('usageLogger', () => {
  describe('isUsageLoggingEnabled', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns true when env var is not set', () => {
      delete process.env['INTEXURAOS_LOG_LLM_USAGE'];
      expect(isUsageLoggingEnabled()).toBe(true);
    });

    it('returns true when env var is empty string', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = '';
      expect(isUsageLoggingEnabled()).toBe(true);
    });

    it('returns false when env var is "false"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'false';
      expect(isUsageLoggingEnabled()).toBe(false);
    });

    it('returns false when env var is "FALSE" (case insensitive)', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'FALSE';
      expect(isUsageLoggingEnabled()).toBe(false);
    });

    it('returns false when env var is "0"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = '0';
      expect(isUsageLoggingEnabled()).toBe(false);
    });

    it('returns false when env var is "no"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'no';
      expect(isUsageLoggingEnabled()).toBe(false);
    });

    it('returns true when env var is "true"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'true';
      expect(isUsageLoggingEnabled()).toBe(true);
    });

    it('returns true when env var is "1"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = '1';
      expect(isUsageLoggingEnabled()).toBe(true);
    });
  });

  describe('UsageLogger.log', () => {
    let logger: Logger;

    const createBaseParams = (): UsageLogParams => ({
      userId: 'user-123',
      provider: LlmProviders.Anthropic,
      model: LlmModels.ClaudeSonnet45,
      callType: 'research' as CallType,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: 0.01,
      },
      success: true,
    });

    beforeEach(() => {
      logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      // Ensure logging is enabled by default
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = undefined;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns early when usage logging is disabled', async () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'false';
      const usageLogger = new UsageLogger({ logger });

      await usageLogger.log(createBaseParams());

      expect(logger.info).not.toHaveBeenCalled();
    });

    it('logs successful LLM usage with all fields', async () => {
      const usageLogger = new UsageLogger({ logger });

      await usageLogger.log(createBaseParams());

      expect(logger.info).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          provider: LlmProviders.Anthropic,
          model: LlmModels.ClaudeSonnet45,
          callType: 'research',
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.01,
          success: true,
        },
        'LLM usage logged'
      );
    });

    it('logs failed LLM usage with error message', async () => {
      const usageLogger = new UsageLogger({ logger });

      const params = createBaseParams();
      params.success = false;
      params.errorMessage = 'Rate limit exceeded';

      await usageLogger.log(params);

      expect(logger.info).toHaveBeenCalledWith(
        {
          userId: 'user-123',
          provider: LlmProviders.Anthropic,
          model: LlmModels.ClaudeSonnet45,
          callType: 'research',
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: 0.01,
          success: false,
          errorMessage: 'Rate limit exceeded',
        },
        'LLM usage logged'
      );
    });

    it('does not include errorMessage when not provided', async () => {
      const usageLogger = new UsageLogger({ logger });

      const params = createBaseParams();
      params.success = false;
      // No errorMessage provided

      await usageLogger.log(params);

      const callArgs = logger.info.mock.calls[0] as unknown[];
      expect(callArgs[0] as Record<string, unknown>).not.toHaveProperty('errorMessage');
    });

    it('supports all call types', async () => {
      const usageLogger = new UsageLogger({ logger });

      const callTypes: CallType[] = [
        'research',
        'generate',
        'image_generation',
        'visualization_insights',
        'visualization_vegalite',
      ];

      for (const callType of callTypes) {
        const params = createBaseParams();
        params.callType = callType;

        await usageLogger.log(params);
      }

      expect(logger.info).toHaveBeenCalledTimes(callTypes.length);
    });

    it('logs error when Firestore throws', async () => {
      const { getFirestore } = await import('@intexuraos/infra-firestore');

      // Make getFirestore throw an error
      vi.mocked(getFirestore).mockImplementationOnce(() => {
        throw new Error('Firestore unavailable');
      });

      const usageLogger = new UsageLogger({ logger });
      const params = createBaseParams();

      await expect(usageLogger.log(params)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('logUsage (legacy function)', () => {
    it('logs usage with silent logger', async () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'false'; // Disable to avoid Firestore calls

      const params: UsageLogParams = {
        userId: 'user-123',
        provider: LlmProviders.OpenAI,
        model: LlmModels.GPT4,
        callType: 'generate',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.001,
        },
        success: true,
      };

      await expect(logUsage(params)).resolves.toBeUndefined();
    });
  });
});
