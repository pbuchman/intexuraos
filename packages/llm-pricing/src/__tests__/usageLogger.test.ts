import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import {
  UsageLogger,
  createUsageLogger,
  isUsageLoggingEnabled,
  NoopUsageSink,
} from '../usageLogger.js';

/**
 * Fake logger for tests.
 */
const fakeLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('usageLogger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env['INTEXURAOS_LOG_LLM_USAGE'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const baseParams = {
    userId: 'user-123',
    provider: LlmProviders.Google,
    model: LlmModels.Gemini25Flash,
    callType: 'research' as const,
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      costUsd: 0.001,
    },
    success: true,
  };

  describe('isUsageLoggingEnabled', () => {
    it('returns true when env var is undefined', () => {
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

    it('returns false when env var is "FALSE"', () => {
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

    it('returns false when env var is "NO"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'NO';
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

    it('returns true when env var is "yes"', () => {
      process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'yes';
      expect(isUsageLoggingEnabled()).toBe(true);
    });
  });

  describe('UsageLogger class', () => {
    describe('constructor', () => {
      it('stores the provided logger and sink', () => {
        const sink = new NoopUsageSink();
        const usageLogger = new UsageLogger({ logger: fakeLogger, sink });
        expect(usageLogger.logger).toBe(fakeLogger);
        expect(usageLogger.sink).toBe(sink);
      });

      it('uses the provided sink when given', () => {
        const customSink = { log: vi.fn().mockResolvedValue(undefined) };
        const usageLogger = new UsageLogger({ logger: fakeLogger, sink: customSink });
        expect(usageLogger.sink).toBe(customSink);
      });
    });

    describe('log', () => {
      it('delegates to the custom sink', async () => {
        const sink = { log: vi.fn().mockResolvedValue(undefined) };
        const usageLogger = new UsageLogger({ logger: fakeLogger, sink });
        await usageLogger.log(baseParams);
        expect(sink.log).toHaveBeenCalledWith(baseParams);
      });

      it('logs usage via logger on success', async () => {
        const sink = { log: vi.fn().mockResolvedValue(undefined) };
        const usageLogger = new UsageLogger({ logger: fakeLogger, sink });
        await usageLogger.log(baseParams);

        expect(fakeLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-123',
            provider: LlmProviders.Google,
            model: LlmModels.Gemini25Flash,
            callType: 'research',
            inputTokens: 100,
            outputTokens: 200,
            totalTokens: 300,
            costUsd: 0.001,
            success: true,
          }),
          'LLM usage logged'
        );
      });

      it('includes errorMessage when success is false', async () => {
        const sink = { log: vi.fn().mockResolvedValue(undefined) };
        const usageLogger = new UsageLogger({ logger: fakeLogger, sink });
        await usageLogger.log({ ...baseParams, success: false, errorMessage: 'boom' });

        expect(fakeLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({ success: false, errorMessage: 'boom' }),
          'LLM usage logged'
        );
      });

      it('logs an error when the sink throws', async () => {
        const sink = { log: vi.fn().mockRejectedValue(new Error('sink boom')) };
        const usageLogger = new UsageLogger({ logger: fakeLogger, sink });
        await usageLogger.log(baseParams);

        expect(fakeLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ error: 'sink boom' }),
          'Failed to log LLM usage'
        );
      });

      it('skips logging when disabled via env var', async () => {
        process.env['INTEXURAOS_LOG_LLM_USAGE'] = 'false';
        const sink = { log: vi.fn().mockResolvedValue(undefined) };
        const usageLogger = new UsageLogger({ logger: fakeLogger, sink });
        await usageLogger.log(baseParams);

        expect(sink.log).not.toHaveBeenCalled();
        expect(fakeLogger.info).not.toHaveBeenCalled();
      });
    });
  });

  describe('NoopUsageSink', () => {
    it('discards all usage events', async () => {
      const sink = new NoopUsageSink();
      await expect(sink.log()).resolves.toBeUndefined();
    });
  });

  describe('createUsageLogger factory', () => {
    it('creates UsageLogger with provided logger and sink', () => {
      const sink = new NoopUsageSink();
      const usageLogger = createUsageLogger({ logger: fakeLogger, sink });
      expect(usageLogger).toBeInstanceOf(UsageLogger);
      expect(usageLogger.logger).toBe(fakeLogger);
      expect(usageLogger.sink).toBe(sink);
    });

    it('passes through a custom sink', () => {
      const customSink = { log: vi.fn().mockResolvedValue(undefined) };
      const usageLogger = createUsageLogger({ logger: fakeLogger, sink: customSink });
      expect(usageLogger.sink).toBe(customSink);
    });
  });
});
