import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import {
  FakeGeneratedImageRepository,
  FakeImageGenerator,
  FakePromptGenerator,
  FakeUserServiceClient,
} from './fakes.js';

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
            return { userId: 'user-123' };
          }
          await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
          return null;
        }
      ),
  };
});

describe('imageRoutes', () => {
  let fakeRepo: FakeGeneratedImageRepository;
  let fakeImageGenerator: FakeImageGenerator;
  let fakePromptGenerator: FakePromptGenerator;
  let fakeUserServiceClient: FakeUserServiceClient;

  beforeEach(() => {
    fakeRepo = new FakeGeneratedImageRepository();
    fakeImageGenerator = new FakeImageGenerator();
    fakePromptGenerator = new FakePromptGenerator();
    fakeUserServiceClient = new FakeUserServiceClient();

    setServices({
      generatedImageRepository: fakeRepo,
      imageGenerator: fakeImageGenerator,
      userServiceClient: fakeUserServiceClient,
      createPromptGenerator: () => fakePromptGenerator,
      generateId: () => 'test-id',
    });
  });

  afterEach(() => {
    resetServices();
    fakeRepo.clear();
  });

  describe('POST /images/generate', () => {
    it('generates an image from a prompt', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          prompt: 'A beautiful sunset over the ocean with silhouetted palm trees.',
          model: 'gpt-image-1',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.id).toBeDefined();
      expect(body.data.thumbnailUrl).toContain('thumbnail.png');
      expect(body.data.fullSizeUrl).toContain('full.png');
    });

    it('saves generated image to repository', async () => {
      const app = await buildServer();

      await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          prompt: 'A beautiful sunset over the ocean with silhouetted palm trees.',
          model: 'gpt-image-1',
        },
      });

      expect(fakeRepo.getAll()).toHaveLength(1);
      expect(fakeRepo.getAll()[0]?.prompt).toBe(
        'A beautiful sunset over the ocean with silhouetted palm trees.'
      );
    });

    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        payload: {
          prompt: 'A beautiful sunset over the ocean.',
          model: 'gpt-image-1',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('validates prompt length minimum', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          prompt: 'short',
          model: 'gpt-image-1',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates required model field', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          prompt: 'A beautiful sunset over the ocean with silhouetted palm trees.',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates model is in allowed list', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          prompt: 'A beautiful sunset over the ocean with silhouetted palm trees.',
          model: 'invalid-model',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('works with dall-e-3 model', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          prompt: 'A beautiful sunset over the ocean with silhouetted palm trees.',
          model: 'dall-e-3',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
    });

    it('returns 502 when image generation fails', async () => {
      const app = await buildServer();
      fakeImageGenerator.setFailNext(true, 'API_ERROR');

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          prompt: 'A beautiful sunset over the ocean with silhouetted palm trees.',
          model: 'gpt-image-1',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('continues even if save to repository fails', async () => {
      const app = await buildServer();
      fakeRepo.setFailNextSave(true);

      const response = await app.inject({
        method: 'POST',
        url: '/images/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          prompt: 'A beautiful sunset over the ocean with silhouetted palm trees.',
          model: 'gpt-image-1',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
