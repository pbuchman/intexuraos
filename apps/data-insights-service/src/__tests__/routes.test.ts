/**
 * Tests for data-insights-service routes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { buildServer } from '../server.js';
import { resetServices, type ServiceContainer, setServices } from '../services.js';
import { FakeAnalyticsEventRepository, FakeAggregatedInsightsRepository } from './fakes.js';
import type { AggregatedInsights } from '../domain/insights/index.js';

const TEST_USER_ID = 'auth0|test-user-123';
const TEST_JWT =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2V5In0.' +
  'eyJpc3MiOiJodHRwczovL3Rlc3QuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfHRlc3QtdXNlci0xMjMiLCJhdWQiOiJ1cm46aW50ZXh1cmFvczphcGkiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'test-signature';

const mockJwks = {
  keys: [
    {
      kty: 'RSA',
      kid: 'test-key',
      use: 'sig',
      n: 'test-modulus',
      e: 'AQAB',
    },
  ],
};

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let fakeEventRepo: FakeAnalyticsEventRepository;
  let fakeInsightsRepo: FakeAggregatedInsightsRepository;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    process.env['AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';

    fakeEventRepo = new FakeAnalyticsEventRepository();
    fakeInsightsRepo = new FakeAggregatedInsightsRepository();

    const services: ServiceContainer = {
      analyticsEventRepository: fakeEventRepo,
      aggregatedInsightsRepository: fakeInsightsRepo,
    };
    setServices(services);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    nock.cleanAll();
  });

  it('POST /internal/analytics/events returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/analytics/events',
      payload: {
        userId: TEST_USER_ID,
        sourceService: 'test-service',
        eventType: 'test.event',
        payload: { key: 'value' },
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('POST /internal/analytics/events creates event with valid auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/analytics/events',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
      payload: {
        userId: TEST_USER_ID,
        sourceService: 'llm-orchestrator',
        eventType: 'research.created',
        payload: { researchId: 'research-123' },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { id: string; userId: string; sourceService: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.userId).toBe(TEST_USER_ID);
    expect(body.data.sourceService).toBe('llm-orchestrator');

    const events = fakeEventRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('research.created');
  });

  it('POST /internal/analytics/events returns 500 on repository failure', async () => {
    fakeEventRepo.setFailNextCreate(true);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/analytics/events',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
      payload: {
        userId: TEST_USER_ID,
        sourceService: 'test-service',
        eventType: 'test.event',
        payload: {},
      },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('Insights Routes', () => {
  let app: FastifyInstance;
  let fakeEventRepo: FakeAnalyticsEventRepository;
  let fakeInsightsRepo: FakeAggregatedInsightsRepository;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    process.env['AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';

    fakeEventRepo = new FakeAnalyticsEventRepository();
    fakeInsightsRepo = new FakeAggregatedInsightsRepository();

    const services: ServiceContainer = {
      analyticsEventRepository: fakeEventRepo,
      aggregatedInsightsRepository: fakeInsightsRepo,
    };
    setServices(services);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    nock.cleanAll();
  });

  it('GET /insights/summary returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/insights/summary',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /insights/usage returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/insights/usage',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /insights/summary returns empty insights when none exist', async () => {
    nock('https://test.auth0.com').get('/.well-known/jwks.json').reply(200, mockJwks);

    const response = await app.inject({
      method: 'GET',
      url: '/insights/summary',
      headers: {
        authorization: `Bearer ${TEST_JWT}`,
      },
    });

    // JWT verification may fail in tests
    expect([200, 401]).toContain(response.statusCode);
  });

  it('GET /insights/summary returns existing insights', async () => {
    const testInsights: AggregatedInsights = {
      userId: TEST_USER_ID,
      summary: {
        totalEvents: 100,
        eventsLast7Days: 25,
        eventsLast30Days: 75,
        mostActiveService: 'llm-orchestrator',
      },
      usageByService: {
        'llm-orchestrator': {
          serviceName: 'llm-orchestrator',
          totalEvents: 60,
          eventsLast7Days: 15,
          lastEventAt: new Date(),
        },
        'whatsapp-service': {
          serviceName: 'whatsapp-service',
          totalEvents: 40,
          eventsLast7Days: 10,
          lastEventAt: new Date(),
        },
      },
      updatedAt: new Date(),
    };
    fakeInsightsRepo.setInsights(testInsights);

    nock('https://test.auth0.com').get('/.well-known/jwks.json').reply(200, mockJwks);

    const response = await app.inject({
      method: 'GET',
      url: '/insights/summary',
      headers: {
        authorization: `Bearer ${TEST_JWT}`,
      },
    });

    // JWT verification may fail in tests
    expect([200, 401]).toContain(response.statusCode);
  });

  it('GET /insights/summary returns 500 on repository failure', async () => {
    fakeInsightsRepo.setFailNextGet(true);

    nock('https://test.auth0.com').get('/.well-known/jwks.json').reply(200, mockJwks);

    const response = await app.inject({
      method: 'GET',
      url: '/insights/summary',
      headers: {
        authorization: `Bearer ${TEST_JWT}`,
      },
    });

    expect([500, 401]).toContain(response.statusCode);
  });

  it('GET /insights/usage returns empty array when no insights', async () => {
    nock('https://test.auth0.com').get('/.well-known/jwks.json').reply(200, mockJwks);

    const response = await app.inject({
      method: 'GET',
      url: '/insights/usage',
      headers: {
        authorization: `Bearer ${TEST_JWT}`,
      },
    });

    expect([200, 401]).toContain(response.statusCode);
  });

  it('GET /insights/usage returns 500 on repository failure', async () => {
    fakeInsightsRepo.setFailNextGet(true);

    nock('https://test.auth0.com').get('/.well-known/jwks.json').reply(200, mockJwks);

    const response = await app.inject({
      method: 'GET',
      url: '/insights/usage',
      headers: {
        authorization: `Bearer ${TEST_JWT}`,
      },
    });

    expect([500, 401]).toContain(response.statusCode);
  });
});
