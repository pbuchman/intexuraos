import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import {
  FakeDataSourceRepository,
  FakeTitleGenerationService,
  FakeCompositeFeedRepository,
  FakeFeedNameGenerationService,
  FakeMobileNotificationsClient,
  FakeVisualizationRepository,
  FakeVisualizationGenerationService,
  FakeSnapshotRepository,
  FakeDataAnalysisService,
  FakeChartDefinitionService,
  FakeDataTransformService,
} from './fakes.js';

const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';

describe('internalRoutes', () => {
  let fakeDataSourceRepo: FakeDataSourceRepository;
  let fakeTitleService: FakeTitleGenerationService;
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeFeedNameService: FakeFeedNameGenerationService;
  let fakeMobileNotificationsClient: FakeMobileNotificationsClient;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeVisualizationRepo: FakeVisualizationRepository;
  let fakeVisualizationGenerationService: FakeVisualizationGenerationService;
  let fakeDataAnalysisService: FakeDataAnalysisService;
  let fakeChartDefinitionService: FakeChartDefinitionService;
  let fakeDataTransformService: FakeDataTransformService;

  beforeEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = TEST_INTERNAL_TOKEN;
    fakeDataSourceRepo = new FakeDataSourceRepository();
    fakeTitleService = new FakeTitleGenerationService();
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeFeedNameService = new FakeFeedNameGenerationService();
    fakeMobileNotificationsClient = new FakeMobileNotificationsClient();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeVisualizationRepo = new FakeVisualizationRepository();
    fakeVisualizationGenerationService = new FakeVisualizationGenerationService();
    fakeDataAnalysisService = new FakeDataAnalysisService();
    fakeChartDefinitionService = new FakeChartDefinitionService();
    fakeDataTransformService = new FakeDataTransformService();
    setServices({
      dataSourceRepository: fakeDataSourceRepo,
      titleGenerationService: fakeTitleService,
      compositeFeedRepository: fakeCompositeFeedRepo,
      feedNameGenerationService: fakeFeedNameService,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      snapshotRepository: fakeSnapshotRepo,
      visualizationRepository: fakeVisualizationRepo,
      visualizationGenerationService: fakeVisualizationGenerationService,
      dataAnalysisService: fakeDataAnalysisService,
      chartDefinitionService: fakeChartDefinitionService,
      dataTransformService: fakeDataTransformService,
    });
  });

  afterEach(() => {
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('POST /internal/snapshots/refresh', () => {
    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/snapshots/refresh',
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ trigger: 'scheduled' })).toString('base64'),
            messageId: 'test-message-id',
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when X-Internal-Auth header has wrong value', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/snapshots/refresh',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ trigger: 'scheduled' })).toString('base64'),
            messageId: 'test-message-id',
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('successfully refreshes all snapshots', async () => {
      const app = await buildServer();

      await fakeCompositeFeedRepo.create('user-1', 'Feed 1', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });

      await fakeCompositeFeedRepo.create('user-2', 'Feed 2', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/snapshots/refresh',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ trigger: 'scheduled' })).toString('base64'),
            messageId: 'test-message-id',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.refreshed).toBe(2);
      expect(body.data.failed).toBe(0);
      expect(body.data.errors).toHaveLength(0);
      expect(body.data.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('handles feeds with missing sources gracefully', async () => {
      const app = await buildServer();

      await fakeCompositeFeedRepo.create('user-1', 'Feed 1', {
        purpose: 'Test purpose',
        staticSourceIds: ['missing-source'],
        notificationFilters: [],
      });

      await fakeCompositeFeedRepo.create('user-2', 'Feed 2', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/snapshots/refresh',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ trigger: 'scheduled' })).toString('base64'),
            messageId: 'test-message-id',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.refreshed).toBe(2);
      expect(body.data.failed).toBe(0);
      expect(body.data.errors).toHaveLength(0);
    });

    it('handles empty feed list', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/snapshots/refresh',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ trigger: 'scheduled' })).toString('base64'),
            messageId: 'test-message-id',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.refreshed).toBe(0);
      expect(body.data.failed).toBe(0);
      expect(body.data.errors).toHaveLength(0);
    });

    it('returns 500 when feed list fetch fails', async () => {
      const app = await buildServer();
      fakeCompositeFeedRepo.setFailNextList(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/snapshots/refresh',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ trigger: 'scheduled' })).toString('base64'),
            messageId: 'test-message-id',
          },
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.error).toContain('Failed to list feeds');
    });

    it('accepts Pub/Sub push from Google without X-Internal-Auth', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/snapshots/refresh',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ trigger: 'scheduled' })).toString('base64'),
            messageId: 'test-message-id',
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('handles invalid base64 in message data gracefully', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/snapshots/refresh',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          message: {
            data: 'not-valid-base64!!!',
            messageId: 'test-message-id',
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('reports errors when snapshot upsert fails', async () => {
      const app = await buildServer();

      await fakeCompositeFeedRepo.create('user-1', 'Feed 1', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });

      fakeSnapshotRepo.setFailNextUpsert(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/snapshots/refresh',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ trigger: 'scheduled' })).toString('base64'),
            messageId: 'test-message-id',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.failed).toBe(1);
      expect(body.data.errors.length).toBeGreaterThan(0);
    });
  });
});
