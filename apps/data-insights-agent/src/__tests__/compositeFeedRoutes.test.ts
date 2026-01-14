import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockImplementation(async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (authHeader === 'Bearer valid-token') {
        return { userId: 'user-123' };
      }
      await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
      return null;
    }),
  };
});

describe('compositeFeedRoutes', () => {
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
    fakeDataSourceRepo.clear();
    fakeCompositeFeedRepo.clear();
  });

  describe('POST /composite-feeds', () => {
    it('creates a new composite feed', async () => {
      const app = await buildServer();

      const sourceResult = await fakeDataSourceRepo.create('user-123', {
        title: 'Source 1',
        content: 'Content 1',
      });
      const source = sourceResult.ok ? sourceResult.value : null;

      fakeFeedNameService.setGeneratedName('AI Generated Feed Name');

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Aggregate my daily feeds',
          staticSourceIds: [source?.id ?? ''],
          notificationFilters: [{ id: 'temp-1', name: 'WhatsApp', app: ['WhatsApp'] }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('AI Generated Feed Name');
      expect(body.data.purpose).toBe('Aggregate my daily feeds');
      expect(body.data.staticSourceIds).toContain(source?.id);
    });

    it('auto-generates filter IDs when not provided', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Test auto-ID',
          staticSourceIds: [],
          notificationFilters: [{ name: 'Filter Without ID', app: ['TestApp'] }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.data.notificationFilters).toHaveLength(1);
      expect(body.data.notificationFilters[0].id).toBeDefined();
      expect(body.data.notificationFilters[0].id.length).toBeGreaterThan(0);
      expect(body.data.notificationFilters[0].name).toBe('Filter Without ID');
    });

    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        payload: {
          purpose: 'Test',
          staticSourceIds: [],
          notificationFilters: [],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when purpose is empty', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: '   ',
          staticSourceIds: [],
          notificationFilters: [],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('Purpose is required');
    });

    it('returns 400 when exceeding max static sources', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Test purpose',
          staticSourceIds: ['s1', 's2', 's3', 's4', 's5', 's6'],
          notificationFilters: [],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toBe('Validation failed');
      expect(body.error.details.errors[0].message).toContain('must NOT have more than 5 items');
    });

    it('returns 400 when exceeding max notification filters', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Test purpose',
          staticSourceIds: [],
          notificationFilters: [
            { id: 't1', name: 'F1' },
            { id: 't2', name: 'F2' },
            { id: 't3', name: 'F3' },
            { id: 't4', name: 'F4' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toBe('Validation failed');
      expect(body.error.details.errors[0].message).toContain('must NOT have more than 3 items');
    });

    it('returns 404 when data source not found', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Test purpose',
          staticSourceIds: ['non-existent-source'],
          notificationFilters: [],
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('Data source not found');
    });

    it('handles name generation errors', async () => {
      const app = await buildServer();

      const sourceResult = await fakeDataSourceRepo.create('user-123', {
        title: 'Source',
        content: 'Content',
      });
      const source = sourceResult.ok ? sourceResult.value : null;

      fakeFeedNameService.setError({
        code: 'GENERATION_ERROR',
        message: 'API rate limit exceeded',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Test purpose',
          staticSourceIds: [source?.id ?? ''],
          notificationFilters: [],
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('handles repository errors during source lookup', async () => {
      const app = await buildServer();

      fakeDataSourceRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Test purpose',
          staticSourceIds: ['some-source'],
          notificationFilters: [],
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('handles repository errors during feed creation', async () => {
      const app = await buildServer();

      fakeCompositeFeedRepo.setFailNextCreate(true);

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Test purpose',
          staticSourceIds: [],
          notificationFilters: [],
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('succeeds when snapshot refresh fails after creation (non-fatal)', async () => {
      const app = await buildServer();

      fakeSnapshotRepo.setFailNextUpsert(true);

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Test purpose',
          staticSourceIds: [],
          notificationFilters: [],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });
  });

  describe('GET /composite-feeds', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds',
      });

      expect(response.statusCode).toBe(401);
    });

    it('lists composite feeds for user', async () => {
      const app = await buildServer();

      await fakeCompositeFeedRepo.create('user-123', 'Feed 1', {
        purpose: 'Purpose 1',
        staticSourceIds: [],
        notificationFilters: [],
      });
      await fakeCompositeFeedRepo.create('user-123', 'Feed 2', {
        purpose: 'Purpose 2',
        staticSourceIds: [],
        notificationFilters: [],
      });
      await fakeCompositeFeedRepo.create('other-user', 'Other Feed', {
        purpose: 'Other purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
    });

    it('returns empty array when no composite feeds', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toEqual([]);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeCompositeFeedRepo.setFailNextList(true);

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /composite-feeds/:id', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/some-id',
      });

      expect(response.statusCode).toBe(401);
    });

    it('gets a composite feed by id', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'My Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.name).toBe('My Feed');
      expect(body.data.purpose).toBe('Test purpose');
    });

    it('returns 404 for non-existent composite feed', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/non-existent',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for other users composite feed', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('other-user', 'Other Feed', {
        purpose: 'Other purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeCompositeFeedRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/some-id',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('PUT /composite-feeds/:id', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'PUT',
        url: '/composite-feeds/some-id',
        payload: { purpose: 'Updated' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('updates a composite feed', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'Original', {
        purpose: 'Original purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'PUT',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Updated purpose',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.purpose).toBe('Updated purpose');
    });

    it('updates static source ids', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: ['old-source'],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'PUT',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          staticSourceIds: ['new-source-1', 'new-source-2'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.staticSourceIds).toEqual(['new-source-1', 'new-source-2']);
    });

    it('updates notification filters', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [{ id: 'old-1', name: 'Old Filter' }],
      });
      const feed = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'PUT',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          notificationFilters: [
            { id: 'new-1', name: 'New Filter 1', app: ['WhatsApp'] },
            { id: 'new-2', name: 'New Filter 2', source: 'slack' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.notificationFilters).toHaveLength(2);
    });

    it('returns 404 for non-existent composite feed', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'PUT',
        url: '/composite-feeds/non-existent',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Updated',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      fakeCompositeFeedRepo.setFailNextUpdate(true);

      const response = await app.inject({
        method: 'PUT',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Updated',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('succeeds when snapshot refresh fails after update (non-fatal)', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      fakeSnapshotRepo.setFailNextUpsert(true);

      const response = await app.inject({
        method: 'PUT',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          purpose: 'Updated',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.purpose).toBe('Updated');
    });
  });

  describe('DELETE /composite-feeds/:id', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/composite-feeds/some-id',
      });

      expect(response.statusCode).toBe(401);
    });

    it('deletes a composite feed', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'To Delete', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'DELETE',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(fakeCompositeFeedRepo.getAll()).toHaveLength(0);
    });

    it('returns 404 for non-existent composite feed', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/composite-feeds/non-existent',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      fakeCompositeFeedRepo.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('succeeds when snapshot delete fails (non-fatal)', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      // First create a snapshot
      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      // Make snapshot delete fail
      fakeSnapshotRepo.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/composite-feeds/${feed?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      // Should still return 200 since snapshot deletion is non-fatal
      expect(response.statusCode).toBe(200);
      // The feed should still be deleted
      expect(fakeCompositeFeedRepo.getAll()).toHaveLength(0);
    });
  });

  describe('GET /composite-feeds/:id/schema', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/some-id/schema',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns JSON schema for composite feed', async () => {
      const app = await buildServer();

      const createResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/schema`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toHaveProperty('$ref');
      expect(body.data).toHaveProperty('definitions');
      expect(body.data.definitions).toHaveProperty('CompositeFeedData');
    });

    it('returns 404 for non-existent feed', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/non-existent/schema',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeCompositeFeedRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/some-id/schema',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /composite-feeds/:id/data', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/some-id/data',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns aggregated data for composite feed', async () => {
      const app = await buildServer();

      const sourceResult = await fakeDataSourceRepo.create('user-123', {
        title: 'My Source',
        content: 'Source content here',
      });
      const source = sourceResult.ok ? sourceResult.value : null;

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'My Feed', {
        purpose: 'Aggregate everything',
        staticSourceIds: [source?.id ?? ''],
        notificationFilters: [{ id: 'f1', name: 'WhatsApp Filter', app: ['WhatsApp'] }],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      fakeMobileNotificationsClient.setNotifications([
        {
          id: 'n1',
          app: 'WhatsApp',
          title: 'Message',
          body: 'Hello world',
          timestamp: '2024-01-01T10:00:00Z',
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/data`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.feedId).toBe(feed?.id);
      expect(body.data.feedName).toBe('My Feed');
      expect(body.data.purpose).toBe('Aggregate everything');
      expect(body.data.staticSources).toHaveLength(1);
      expect(body.data.staticSources[0].name).toBe('My Source');
      expect(body.data.notifications).toHaveLength(1);
      expect(body.data.notifications[0].items).toHaveLength(1);
    });

    it('returns 404 for non-existent feed', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/non-existent/data',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles missing data sources gracefully', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: ['deleted-source'],
        notificationFilters: [],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/data`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.staticSources).toHaveLength(0);
    });

    it('handles notification client errors gracefully', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [{ id: 'f1', name: 'Filter 1', app: ['App1'] }],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      fakeMobileNotificationsClient.setError('Network error');

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/data`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.notifications[0].items).toEqual([]);
    });

    it('returns data with filter criteria', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [
          {
            id: 'f1',
            name: 'Complex Filter',
            app: ['WhatsApp'],
            source: 'work',
            title: 'urgent',
          },
        ],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/data`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.notifications[0].criteria).toEqual({
        app: ['WhatsApp'],
        source: 'work',
        title: 'urgent',
      });
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeCompositeFeedRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/some-id/data',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('handles data source repository errors gracefully', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: ['source-1'],
        notificationFilters: [],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      fakeDataSourceRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/data`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.staticSources).toHaveLength(0);
    });
  });

  describe('GET /composite-feeds/:id/snapshot', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/some-id/snapshot',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns snapshot when it exists', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: '2026-01-09T12:00:00.000Z',
        staticSources: [],
        notifications: [],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/snapshot`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.feedId).toBe(feed?.id);
      expect(body.data.feedName).toBe('Test Feed');
      expect(body.data.generatedAt).toBeDefined();
    });

    it('returns 404 when snapshot does not exist', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/snapshot`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 for non-existent feed', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/non-existent/snapshot',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when accessing other users feed', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('other-user', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/snapshot`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      fakeSnapshotRepo.getByFeedId = async (): Promise<{ ok: false; error: string }> => ({
        ok: false,
        error: 'Database error',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/snapshot`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('forces refresh when refresh=true query param is provided', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/snapshot?refresh=true`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.feedId).toBe(feed?.id);
      expect(body.data.feedName).toBe('Test Feed');
    });

    it('returns error when refresh fails due to non-existent feed', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/non-existent/snapshot?refresh=true',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
    });

    it('returns error when snapshot refresh fails with existing feed', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = feedResult.ok ? feedResult.value : null;

      fakeSnapshotRepo.setFailNextUpsert(true);

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/snapshot?refresh=true`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
