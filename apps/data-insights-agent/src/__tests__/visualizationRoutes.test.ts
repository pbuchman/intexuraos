import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import {
  FakeVisualizationRepository,
  FakeVisualizationGenerationService,
  FakeSnapshotRepository,
  FakeCompositeFeedRepository,
  FakeDataSourceRepository,
  FakeTitleGenerationService,
  FakeFeedNameGenerationService,
  FakeMobileNotificationsClient,
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

describe('visualizationRoutes', () => {
  let fakeVisualizationRepo: FakeVisualizationRepository;
  let fakeVisualizationGenerationService: FakeVisualizationGenerationService;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeDataSourceRepo: FakeDataSourceRepository;
  let fakeTitleService: FakeTitleGenerationService;
  let fakeFeedNameService: FakeFeedNameGenerationService;
  let fakeMobileNotificationsClient: FakeMobileNotificationsClient;

  beforeEach(() => {
    fakeVisualizationRepo = new FakeVisualizationRepository();
    fakeVisualizationGenerationService = new FakeVisualizationGenerationService();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeDataSourceRepo = new FakeDataSourceRepository();
    fakeTitleService = new FakeTitleGenerationService();
    fakeFeedNameService = new FakeFeedNameGenerationService();
    fakeMobileNotificationsClient = new FakeMobileNotificationsClient();
    setServices({
      visualizationRepository: fakeVisualizationRepo,
      visualizationGenerationService: fakeVisualizationGenerationService,
      snapshotRepository: fakeSnapshotRepo,
      compositeFeedRepository: fakeCompositeFeedRepo,
      dataSourceRepository: fakeDataSourceRepo,
      titleGenerationService: fakeTitleService,
      feedNameGenerationService: fakeFeedNameService,
      mobileNotificationsClient: fakeMobileNotificationsClient,
    });
  });

  afterEach(() => {
    resetServices();
    fakeVisualizationRepo.clear();
    fakeSnapshotRepo.clear();
    fakeCompositeFeedRepo.clear();
    fakeDataSourceRepo.clear();
  });

  describe('GET /composite-feeds/:feedId/visualizations', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/feed-1/visualizations',
      });

      expect(response.statusCode).toBe(401);
    });

    it('lists visualizations for feed', async () => {
      const app = await buildServer();

      await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Viz 1',
        description: 'First visualization',
        type: 'chart',
      });
      await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Viz 2',
        description: 'Second visualization',
        type: 'table',
      });
      await fakeVisualizationRepo.create('feed-2', 'user-123', {
        title: 'Other Viz',
        description: 'Other feed visualization',
        type: 'summary',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].feedId).toBe('feed-1');
      expect(body.data[1].feedId).toBe('feed-1');
    });

    it('returns empty array when no visualizations exist', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toEqual([]);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeVisualizationRepo.setFailNextList(true);

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /composite-feeds/:feedId/visualizations', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations',
        payload: {
          title: 'Test Viz',
          description: 'Test description',
          type: 'chart',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('creates visualization in pending status', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Sales Chart',
          description: 'Monthly sales trends',
          type: 'chart',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Sales Chart');
      expect(body.data.description).toBe('Monthly sales trends');
      expect(body.data.type).toBe('chart');
      expect(body.data.status).toBe('pending');
      expect(body.data.htmlContent).toBe(null);
    });

    it('returns 400 when title is empty', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: '   ',
          description: 'Test description',
          type: 'chart',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('Title cannot be empty');
    });

    it('returns 400 when description is empty', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Test Title',
          description: '   ',
          type: 'chart',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('Description cannot be empty');
    });

    it('returns 400 when title exceeds max length', async () => {
      const app = await buildServer();
      const longTitle = 'a'.repeat(201);

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: longTitle,
          description: 'Test description',
          type: 'chart',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('must NOT have more than 200 characters');
    });

    it('returns 400 when description exceeds max length', async () => {
      const app = await buildServer();
      const longDescription = 'a'.repeat(1001);

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Test Title',
          description: longDescription,
          type: 'chart',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('must NOT have more than 1000 characters');
    });

    it('creates multiple visualizations for same feed', async () => {
      const app = await buildServer();

      const response1 = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Viz 1',
          description: 'First',
          type: 'chart',
        },
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Viz 2',
          description: 'Second',
          type: 'table',
        },
      });

      expect(response1.statusCode).toBe(201);
      expect(response2.statusCode).toBe(201);

      const listResult = await fakeVisualizationRepo.listByFeedId('feed-1', 'user-123');
      expect(listResult.ok && listResult.value).toHaveLength(2);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeVisualizationRepo.setFailNextCreate(true);

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Test Viz',
          description: 'Test description',
          type: 'chart',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /composite-feeds/:feedId/visualizations/:id', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/feed-1/visualizations/viz-1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('gets visualization by id', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.title).toBe('Test Viz');
      expect(body.data.description).toBe('Test description');
      expect(body.data.type).toBe('chart');
    });

    it('returns 404 for non-existent visualization', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/feed-1/visualizations/non-existent',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for visualization from different feed', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'GET',
        url: `/composite-feeds/feed-2/visualizations/${viz?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeVisualizationRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'GET',
        url: '/composite-feeds/feed-1/visualizations/viz-1',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('PUT /composite-feeds/:feedId/visualizations/:id', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'PUT',
        url: '/composite-feeds/feed-1/visualizations/viz-1',
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('updates visualization title', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Original Title',
        description: 'Original description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'PUT',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Updated Title',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.title).toBe('Updated Title');
      expect(body.data.description).toBe('Original description');
    });

    it('updates visualization description', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Title',
        description: 'Original description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'PUT',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          description: 'Updated description',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.description).toBe('Updated description');
      expect(body.data.title).toBe('Test Title');
    });

    it('updates visualization type', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Title',
        description: 'Test description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'PUT',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          type: 'table',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.type).toBe('table');
    });

    it('returns 404 for non-existent visualization', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'PUT',
        url: '/composite-feeds/feed-1/visualizations/non-existent',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Updated',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Title',
        description: 'Test description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      fakeVisualizationRepo.setFailNextUpdate(true);

      const response = await app.inject({
        method: 'PUT',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          title: 'Updated',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('DELETE /composite-feeds/:feedId/visualizations/:id', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/composite-feeds/feed-1/visualizations/viz-1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('deletes visualization', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'To Delete',
        description: 'Will be deleted',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'DELETE',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);

      const listResult = await fakeVisualizationRepo.listByFeedId('feed-1', 'user-123');
      expect(listResult.ok && listResult.value).toHaveLength(0);
    });

    it('returns 404 for non-existent visualization', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/composite-feeds/feed-1/visualizations/non-existent',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test',
        description: 'Test',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      fakeVisualizationRepo.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /composite-feeds/:feedId/visualizations/:id/regenerate', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations/viz-1/regenerate',
      });

      expect(response.statusCode).toBe(401);
    });

    it('starts regeneration and returns 202', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}/regenerate`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
    });

    it('returns 404 for non-existent visualization', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations/non-existent/regenerate',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();
      fakeVisualizationRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations/viz-1/regenerate',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /composite-feeds/:feedId/visualizations/:id/report-error', () => {
    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations/viz-1/report-error',
        payload: { errorMessage: 'Test error' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('increments error count', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}/report-error`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          errorMessage: 'Script execution failed',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.errorCount).toBe(1);
      expect(body.data.disabled).toBe(false);
    });

    it('disables visualization after max errors', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      for (let i = 0; i < 10; i++) {
        await app.inject({
          method: 'POST',
          url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}/report-error`,
          headers: { authorization: 'Bearer valid-token' },
          payload: {
            errorMessage: `Error ${String(i + 1)}`,
          },
        });
      }

      const getResult = await fakeVisualizationRepo.getById(
        viz?.id ?? '',
        'feed-1',
        'user-123'
      );
      expect(getResult.ok && getResult.value?.status).toBe('error');
    });

    it('returns 404 for non-existent visualization', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/feed-1/visualizations/non-existent/report-error',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          errorMessage: 'Test error',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('handles repository errors', async () => {
      const app = await buildServer();

      const createResult = await fakeVisualizationRepo.create('feed-1', 'user-123', {
        title: 'Test Viz',
        description: 'Test description',
        type: 'chart',
      });
      const viz = createResult.ok ? createResult.value : null;

      fakeVisualizationRepo.setFailNextIncrement(true);

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/feed-1/visualizations/${viz?.id ?? 'missing'}/report-error`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          errorMessage: 'Test error',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
