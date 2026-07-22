import {
  intexuraFastifyPlugin,
  logIncomingRequest,
  registerQuietHealthCheckLogging,
  requireAuth,
} from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import { setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntexAgentSessionEvent } from '../../domain/sessions/types.js';
import type { TestRunScenarioProjectionV1 } from '../../domain/testRuns/types.js';
import {
  createTestRunRoutes,
  type TestRunRoutesDependencies,
} from '../../routes/testRunRoutes.js';
import { buildServer } from '../../server.js';
import { resetServices, setServices, type ServiceContainer } from '../../services.js';
import { testRunRecord, testRunScenario, testRunNow } from '../domain/testRuns/testRunFixtures.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual<typeof import('@intexuraos/common-http')>(
    '@intexuraos/common-http'
  );
  return {
    ...actual,
    logIncomingRequest: vi.fn(actual.logIncomingRequest),
    registerQuietHealthCheckLogging: vi.fn(actual.registerQuietHealthCheckLogging),
    requireAuth: vi.fn(),
  };
});

vi.mock('@intexuraos/infra-sentry', async () => {
  const actual = await vi.importActual<typeof import('@intexuraos/infra-sentry')>(
    '@intexuraos/infra-sentry'
  );
  return {
    ...actual,
    setupSentryErrorHandler: vi.fn(actual.setupSentryErrorHandler),
  };
});

const bindingDigest = '9'.repeat(64);

function visibleRun(): ReturnType<typeof testRunRecord> {
  const scenarios = Array.from({ length: 20 }, (_, index) =>
    testRunScenario(
      index + 1,
      index === 0
        ? {
            scenarioRevision: 1,
            eventWatermark: 2,
            lifecycle: 'running',
            completedTurns: 1,
            completedReplies: 1,
            sessionId: 'private_session_1',
            sessionBindingDigest: bindingDigest,
          }
        : {}
    )
  );
  return testRunRecord({ revision: 3, lifecycle: 'running', scenarios });
}

function projection(): TestRunScenarioProjectionV1 {
  return {
    schemaVersion: 1,
    runId: 'run_1',
    userId: 'auth0:user_1',
    sessionId: 'private_session_1',
    sessionBindingDigest: bindingDigest,
    scenarioId: 'scenario_001',
    scenarioNumber: 1,
    scenarioLabel: 'Scenario 001/020',
    runRevision: 3,
    scenarioRevision: 1,
    eventWatermark: 2,
    lifecycle: 'running',
    verdict: 'pending',
    plannedTurns: 1,
    completedTurns: 1,
    toolEvidence: [],
    deterministicChecks: [],
    replyEvaluations: [],
    agentUsage: [],
  };
}

function events(): IntexAgentSessionEvent[] {
  return [
    {
      id: 'private_event_1',
      sessionId: 'private_session_1',
      userId: 'auth0:user_1',
      type: 'user_message',
      payload: { text: 'Natural request', turnIndex: 0, capability: 'private' },
      createdAt: testRunNow,
      eventSequence: 1,
    },
    {
      id: 'private_event_2',
      sessionId: 'private_session_1',
      userId: 'auth0:user_1',
      type: 'assistant_message',
      payload: { text: 'Natural reply', providerRequestId: 'private-provider' },
      createdAt: testRunNow,
      eventSequence: 2,
    },
  ];
}

describe('Test Runs public routes', () => {
  let app: FastifyInstance;
  const listLatestForUser = vi.fn<
    TestRunRoutesDependencies['repository']['listLatestForUser']
  >(async () => ({
      ok: true as const,
      records: [visibleRun()],
    }));
  const getScenarioConsistent = vi.fn<
    TestRunRoutesDependencies['repository']['getScenarioConsistent']
  >(async () => ({
      ok: true as const,
      run: visibleRun(),
      projection: projection(),
      events: events(),
    }));
  const repository = { listLatestForUser, getScenarioConsistent };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'auth0:user_1', claims: {} });
    app = Fastify({ logger: false });
    await app.register(intexuraFastifyPlugin);
    registerCoreSchemas(app);
    await app.register(
      createTestRunRoutes({
        enabled: true,
        runtimeAudience: 'hetzner-prod',
        configuredUserId: 'auth0:user_1',
        repository,
      })
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('authenticates before any repository read', async () => {
    vi.mocked(requireAuth).mockImplementationOnce(async (_request, reply: FastifyReply) => {
      void reply.fail('UNAUTHORIZED', 'Missing authentication');
      return null;
    });

    const response = await app.inject({ method: 'GET', url: '/test-runs' });

    expect(response.statusCode).toBe(401);
    expect(repository.listLatestForUser).not.toHaveBeenCalled();
  });

  it.each(['/test-runs/run_1', '/test-runs/run_1/scenarios/scenario_001'])(
    'stops an unauthenticated nested read before repository access for %s',
    async (url) => {
      vi.mocked(requireAuth).mockImplementationOnce(async (_request, reply: FastifyReply) => {
        void reply.fail('UNAUTHORIZED', 'Missing authentication');
        return null;
      });

      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(401);
      expect(repository.listLatestForUser).not.toHaveBeenCalled();
      expect(repository.getScenarioConsistent).not.toHaveBeenCalled();
    }
  );

  it('returns the same static 404 and performs zero reads for a non-evaluator user', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ userId: 'auth0:foreign', claims: {} });

    const response = await app.inject({ method: 'GET', url: '/test-runs' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Test Runs resource not found' },
    });
    expect(repository.listLatestForUser).not.toHaveBeenCalled();
  });

  it('lists at most the retained safe headers newest first with no-store', async () => {
    const response = await app.inject({ method: 'GET', url: '/test-runs' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(repository.listLatestForUser).toHaveBeenCalledWith('auth0:user_1', 4);
    expect(response.json()).toMatchObject({
      success: true,
      data: { runs: [{ runId: 'run_1', revision: 3 }] },
    });
    expect(response.body).not.toContain('auth0:user_1');
    expect(response.body).not.toContain('private_session_1');
  });

  it.each([
    '/test-runs?unexpected=1',
    '/test-runs/run_1?unexpected=1',
    '/test-runs/run_1/scenarios/scenario_001?unexpected=1',
  ])('rejects unknown query fields before repository reads for %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(400);
    expect(repository.listLatestForUser).not.toHaveBeenCalled();
    expect(repository.getScenarioConsistent).not.toHaveBeenCalled();
  });

  it('returns a retained run with exactly twenty safe scenario summaries', async () => {
    const response = await app.inject({ method: 'GET', url: '/test-runs/run_1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.scenarios).toHaveLength(20);
    expect(response.body).not.toContain('sessionBindingDigest');
  });

  it('hides a superseded run behind the same static 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/test-runs/run_hidden' });

    expect(response.statusCode).toBe(404);
    expect(repository.getScenarioConsistent).not.toHaveBeenCalled();
  });

  it('hides a scenario from a superseded run before reading its projection', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-runs/run_hidden/scenarios/scenario_001',
    });

    expect(response.statusCode).toBe(404);
    expect(repository.getScenarioConsistent).not.toHaveBeenCalled();
  });

  it('returns a safe scenario timeline without private transport or event fields', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-runs/run_1/scenarios/scenario_001',
    });

    expect(response.statusCode).toBe(200);
    expect(repository.getScenarioConsistent).toHaveBeenCalledWith({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      userId: 'auth0:user_1',
    });
    expect(response.json().data.timeline.map((entry: { type: string }) => entry.type)).toEqual([
      'user_message',
      'assistant_message',
    ]);
    expect(response.body).not.toContain('private_event_');
    expect(response.body).not.toContain('private-provider');
  });

  it('returns a static retryable conflict for a stale scenario projection', async () => {
    repository.getScenarioConsistent.mockResolvedValueOnce({
      ok: false as const,
      code: 'STALE_PROJECTION' as const,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-runs/run_1/scenarios/scenario_001',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: 'CONFLICT', message: 'Test Runs projection is stale; retry the request' },
    });
  });

  it.each([
    '/test-runs',
    '/test-runs/run_1',
    '/test-runs/run_1/scenarios/scenario_001',
  ])('maps a retention repository failure statically for %s', async (url) => {
    repository.listLatestForUser.mockResolvedValueOnce({
      ok: false as const,
      code: 'CORRUPT_RECORD' as const,
    });

    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Test Runs data unavailable' },
    });
  });

  it('fails closed when retained data cannot be mapped to a public DTO', async () => {
    repository.listLatestForUser.mockResolvedValueOnce({
      ok: true as const,
      records: [{ ...visibleRun(), corpusId: 'not safe id' }],
    });

    const list = await app.inject({ method: 'GET', url: '/test-runs' });
    repository.listLatestForUser.mockResolvedValueOnce({
      ok: true as const,
      records: [{ ...visibleRun(), corpusId: 'not safe id' }],
    });
    const detail = await app.inject({ method: 'GET', url: '/test-runs/run_1' });

    expect(list.statusCode).toBe(500);
    expect(detail.statusCode).toBe(500);
  });

  it('returns static 404 for a missing scenario and conflict for invalid mapped evidence', async () => {
    repository.getScenarioConsistent.mockResolvedValueOnce({
      ok: false as const,
      code: 'NOT_FOUND' as const,
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/test-runs/run_1/scenarios/scenario_001',
    });
    repository.getScenarioConsistent.mockResolvedValueOnce({
      ok: true as const,
      run: visibleRun(),
      projection: projection(),
      events: [],
    });
    const invalid = await app.inject({
      method: 'GET',
      url: '/test-runs/run_1/scenarios/scenario_001',
    });

    expect(missing.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(409);
  });
});

describe('Test Runs server registration guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetServices();
  });

  it('registers reads and starts/stops the sweeper only for the enabled Home Dev runtime', async () => {
    const sweepScheduler = { start: vi.fn(), stop: vi.fn() };
    const repository = {
      listLatestForUser: vi.fn(async () => ({ ok: true as const, records: [visibleRun()] })),
      getScenarioConsistent: vi.fn(async () => ({
        ok: true as const,
        run: visibleRun(),
        projection: projection(),
        events: events(),
      })),
    };
    setServices(
      serverServices({
        testRuns: {
          enabled: true,
          runtimeAudience: 'hetzner-prod',
          configuredUserId: 'auth0:user_1',
          repository,
          sweepScheduler,
        },
      })
    );
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'auth0:user_1', claims: {} });
    const server = await buildServer();
    await server.ready();

    expect(sweepScheduler.start).toHaveBeenCalledOnce();
    expect((await server.inject({ method: 'GET', url: '/test-runs' })).statusCode).toBe(200);
    await server.close();
    expect(sweepScheduler.stop).toHaveBeenCalledOnce();
  });

  it('leaves every Test Runs route absent when the server-side guard is disabled', async () => {
    setServices(serverServices());
    const server = await buildServer();
    await server.ready();

    const response = await server.inject({ method: 'GET', url: '/test-runs' });

    expect(response.statusCode).toBe(404);
    await server.close();
  });

  it('registers public Test Runs as private for request logs and Sentry', async () => {
    setServices(
      serverServices({
        testRuns: {
          enabled: true,
          runtimeAudience: 'hetzner-prod',
          configuredUserId: 'auth0:user_1',
          repository: {
            listLatestForUser: vi.fn(async () => ({ ok: true as const, records: [] })),
            getScenarioConsistent: vi.fn(),
          },
          sweepScheduler: { start: vi.fn(), stop: vi.fn(async () => undefined) },
        },
      })
    );
    vi.mocked(requireAuth).mockResolvedValue({ userId: 'auth0:user_1', claims: {} });
    const server = await buildServer();
    await server.ready();

    await server.inject({
      method: 'GET',
      url: '/test-runs/RUN_PRIVATE_SENTINEL',
    });
    await server.close();

    expect(registerQuietHealthCheckLogging).toHaveBeenCalledWith(
      expect.anything(),
      {
        privatePathPrefixes: expect.arrayContaining([
          '/internal/intex-agent/messages',
          '/test-runs',
        ]),
      }
    );
    expect(setupSentryErrorHandler).toHaveBeenCalledWith(
      expect.anything(),
      {
        privatePathPrefixes: expect.arrayContaining([
          '/internal/intex-agent/messages',
          '/test-runs',
        ]),
      }
    );
    expect(logIncomingRequest).toHaveBeenCalledOnce();
    expect(logIncomingRequest).toHaveBeenCalledWith(expect.anything(), {
      message: 'Received protected Test Runs request',
      bodyPreviewLength: 0,
      includeHeaders: false,
      includeParams: false,
    });
  });
});

function serverServices(
  overrides: Partial<ServiceContainer> = {}
): ServiceContainer {
  return {
    config: {
      port: 8080,
      host: '127.0.0.1',
      gcpProjectId: 'test-project',
      internalAuthToken: 'test-token',
      userServiceUrl: 'http://user.test',
      notesAgentUrl: 'http://notes.test',
      calendarAgentUrl: 'http://calendar.test',
      researchAgentUrl: 'http://research.test',
      bookmarksAgentUrl: 'http://bookmarks.test',
      codeAgentUrl: 'http://code.test',
      webAppUrl: 'https://dev.intexuraos.cloud',
      llmUsageServiceUrl: 'http://usage.test',
      openRouterAppApiKey: 'test-key',
      whatsappSendTopic: 'test-topic',
      sessionTimeoutMs: 1,
      matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
      testRunsRead: { enabled: false },
    },
    sessionRepository: {} as ServiceContainer['sessionRepository'],
    preferencesRepository: {} as ServiceContainer['preferencesRepository'],
    promptPreferencesRepository: {} as ServiceContainer['promptPreferencesRepository'],
    externalSaveTester: {} as ServiceContainer['externalSaveTester'],
    incomingMessageHandler: { handle: vi.fn() },
    testConversationRunner: { run: vi.fn() },
    ...overrides,
  };
}
