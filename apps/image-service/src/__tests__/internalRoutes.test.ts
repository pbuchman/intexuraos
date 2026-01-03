import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';
import { FakeGeneratedImageRepository, FakeImageStorage } from './fakes.js';

const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let fakeStorage: FakeImageStorage;
  let fakeRepo: FakeGeneratedImageRepository;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = TEST_INTERNAL_TOKEN;

    fakeStorage = new FakeImageStorage();
    fakeRepo = new FakeGeneratedImageRepository();

    const services: ServiceContainer = {
      generatedImageRepository: fakeRepo,
      imageStorage: fakeStorage,
      userServiceClient: {
        getApiKeys: async () => ({ ok: true, value: {} }) as never,
      },
      createPromptGenerator: () => {
        throw new Error('Not implemented');
      },
      createImageGenerator: () => {
        throw new Error('Not implemented');
      },
      generateId: () => 'test-uuid',
    };

    setServices(services);
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('DELETE /internal/images/:id', () => {
    const testImage = {
      id: 'internal-image-to-delete',
      userId: 'some-user',
      prompt: 'Test prompt',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      fullSizeUrl: 'https://example.com/full.png',
      model: 'gpt-image-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/internal/images/image-123',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when X-Internal-Auth header has wrong value', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/internal/images/image-123',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async () => {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

      const response = await app.inject({
        method: 'DELETE',
        url: '/internal/images/image-123',
        headers: {
          'x-internal-auth': 'any-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('deletes image successfully', async () => {
      fakeRepo.setImage(testImage);

      const response = await app.inject({
        method: 'DELETE',
        url: `/internal/images/${testImage.id}`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      expect(fakeRepo.hasImage(testImage.id)).toBe(false);
    });

    it('returns success even when image does not exist', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/internal/images/non-existent-id',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
    });

    it('returns success even when storage delete fails', async () => {
      fakeRepo.setImage(testImage);
      fakeStorage.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/internal/images/${testImage.id}`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
    });

    it('returns success even when repository delete fails', async () => {
      fakeRepo.setImage(testImage);
      fakeRepo.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/internal/images/${testImage.id}`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
    });
  });
});
