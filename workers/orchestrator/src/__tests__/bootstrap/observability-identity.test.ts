import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@intexuraos/infra-sentry', () => ({
  initWorker: vi.fn(() => ({
    logger: {},
    flush: vi.fn(async () => undefined),
  })),
}));

import { initWorker } from '@intexuraos/infra-sentry';
import { initOrchestratorObservability } from '../../bootstrap/observability-identity.js';

describe('initOrchestratorObservability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the legacy host identity only to the initWorker environment sink', () => {
    initOrchestratorObservability({}, { INTEXURAOS_ENVIRONMENT: 'home-dev' });

    expect(initWorker).toHaveBeenCalledWith({
      serviceName: 'orchestrator',
      environment: 'home-dev',
    });
  });

  it('falls back to NODE_ENV and then development', () => {
    initOrchestratorObservability({}, { NODE_ENV: 'staging' });
    initOrchestratorObservability({}, {});

    expect(initWorker).toHaveBeenNthCalledWith(1, {
      serviceName: 'orchestrator',
      environment: 'staging',
    });
    expect(initWorker).toHaveBeenNthCalledWith(2, {
      serviceName: 'orchestrator',
      environment: 'development',
    });
  });

  it('forwards optional Sentry metadata without exposing identity to service config', () => {
    initOrchestratorObservability(
      { sentryDsn: 'https://example@sentry.io/1', release: 'orchestrator-00099-rev' },
      { INTEXURAOS_ENVIRONMENT: 'production' }
    );

    expect(initWorker).toHaveBeenCalledWith({
      serviceName: 'orchestrator',
      environment: 'production',
      sentryDsn: 'https://example@sentry.io/1',
      release: 'orchestrator-00099-rev',
    });
  });
});
