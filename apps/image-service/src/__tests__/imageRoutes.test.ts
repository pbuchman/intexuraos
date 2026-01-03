import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';
import {
  FakeGeneratedImageRepository,
  FakeImageStorage,
  FakeUserServiceClient,
  FakeImageGenerator,
} from './fakes.js';

const TEST_USER_ID = 'test-user-123';

vi.mock('@intexuraos/common-http', async (): Promise<object> => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi
      .fn()
      .mockImplementation(
        async (
          request: { headers: { authorization?: string } },
          reply: { fail: (code: string, message: string) => Promise<void> }
        ) => {
          const authHeader = request.headers.authorization;
          if (authHeader === 'Bearer valid-token') {
            return { userId: TEST_USER_ID };
          }
          await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
          return null;
        }
      ),
  };
});

describe('Image Routes', () => {
  let app: FastifyInstance;
  let fakeStorage: FakeImageStorage;
  let fakeRepo: FakeGeneratedImageRepository;
  let fakeUserClient: FakeUserServiceClient;
  let fakeGenerator: FakeImageGenerator;

  beforeEach(async () => {
    fakeStorage = new FakeImageStorage();
    fakeRepo = new FakeGeneratedImageRepository();
    fakeUserClient = new FakeUserServiceClient();
    fakeGenerator = new FakeImageGenerator();

    const services: ServiceContainer = {
      generatedImageRepository: fakeRepo,
      imageStorage: fakeStorage,
      userServiceClient: fakeUserClient,
      createPromptGenerator: () => {
        throw new Error('Not implemented');
      },
      createImageGenerator: () => fakeGenerator,
      generateId: () => 'test-uuid',
    };

    setServices(services);
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('POST /images/generate', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        payload: { prompt: 'A beautiful sunset', model: 'gpt-image-1' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when prompt is too short', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: { prompt: 'short', model: 'gpt-image-1' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when model is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: { prompt: 'A beautiful sunset over mountains', model: 'invalid-model' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 502 when user service fails to get API keys', async () => {
      fakeUserClient.setFailNext(true);

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: { prompt: 'A beautiful sunset over mountains', model: 'gpt-image-1' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 400 when required API key is not configured', async () => {
      fakeUserClient.setApiKeys({});

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: { prompt: 'A beautiful sunset over mountains', model: 'gpt-image-1' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('API key');
    });

    it('returns 502 when image generation fails', async () => {
      fakeUserClient.setApiKeys({ openai: 'test-openai-key' });
      fakeGenerator.setFailNext(true);

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: { prompt: 'A beautiful sunset over mountains', model: 'gpt-image-1' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 500 and cleans up storage when DB save fails', async () => {
      fakeUserClient.setApiKeys({ openai: 'test-openai-key' });
      fakeRepo.setFailNextSave(true);

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: { prompt: 'A beautiful sunset over mountains', model: 'gpt-image-1' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Failed to save image record');
    });

    it('generates image successfully with openai model', async () => {
      fakeUserClient.setApiKeys({ openai: 'test-openai-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: { prompt: 'A beautiful sunset over mountains', model: 'gpt-image-1' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { id: string; thumbnailUrl: string; fullSizeUrl: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('test-generated-id');
      expect(body.data.thumbnailUrl).toContain('thumbnail.jpg');
      expect(body.data.fullSizeUrl).toContain('full.png');

      const savedImage = fakeRepo.getImage('test-generated-id');
      expect(savedImage).toBeDefined();
      expect(savedImage?.userId).toBe(TEST_USER_ID);
    });

    it('generates image successfully with google model', async () => {
      fakeUserClient.setApiKeys({ google: 'test-google-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: { prompt: 'A beautiful sunset over mountains', model: 'nano-banana-pro' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });
  });

  describe('DELETE /images/:id', () => {
    const testImage = {
      id: 'image-to-delete',
      userId: TEST_USER_ID,
      prompt: 'Test prompt',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      fullSizeUrl: 'https://example.com/full.png',
      model: 'gpt-image-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    it('returns 401 when not authenticated', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/images/image-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when image not found', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/images/non-existent-id',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 when user does not own the image', async () => {
      fakeRepo.setImage({ ...testImage, userId: 'other-user' });

      const response = await app.inject({
        method: 'DELETE',
        url: `/images/${testImage.id}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('deletes image successfully', async () => {
      fakeRepo.setImage(testImage);

      const response = await app.inject({
        method: 'DELETE',
        url: `/images/${testImage.id}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      expect(fakeRepo.hasImage(testImage.id)).toBe(false);
    });

    it('returns success even when storage delete fails', async () => {
      fakeRepo.setImage(testImage);
      fakeStorage.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/images/${testImage.id}`,
        headers: { authorization: 'Bearer valid-token' },
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
        url: `/images/${testImage.id}`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
    });
  });
});
