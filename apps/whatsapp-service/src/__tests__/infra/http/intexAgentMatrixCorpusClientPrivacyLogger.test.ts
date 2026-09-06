import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpConfigs: [] as Record<string, unknown>[],
  evidenceConfigs: [] as Record<string, unknown>[],
}));

vi.mock('@intexuraos/internal-clients', () => ({
  createInternalHttpClient(config: Record<string, unknown>): { request: ReturnType<typeof vi.fn> } {
    mocks.httpConfigs.push(config);
    return { request: vi.fn() };
  },
  createIntexAgentServiceClient(config: Record<string, unknown>): Record<string, never> {
    mocks.evidenceConfigs.push(config);
    return {};
  },
}));

const { createIntexAgentMatrixCorpusClient } =
  await import('../../../infra/http/intexAgentMatrixCorpusClient.js');

describe('IntexAgentMatrixCorpusClient privacy logger composition', () => {
  it('suppresses informational payloads and emits one content-free warning for failures', () => {
    const logger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    createIntexAgentMatrixCorpusClient({
      baseUrl: 'https://intex-agent.example.test',
      internalAuthToken: 'private-token',
      logger,
    });

    const privacyLogger = mocks.httpConfigs[0]?.['logger'] as typeof logger;
    privacyLogger.info({ private: 'value' }, 'private message');
    privacyLogger.debug({ private: 'value' }, 'private message');
    privacyLogger.error({ private: 'value' }, 'private message');
    privacyLogger.warn({ private: 'value' }, 'private message');

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      { component: 'intex-agent-matrix-corpus-client' },
      'Intex Agent Matrix corpus request failed'
    );
    expect(mocks.httpConfigs[0]).not.toHaveProperty('defaultTimeoutMs');
    expect(mocks.evidenceConfigs[0]).not.toHaveProperty('defaultTimeoutMs');
  });
});
