import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';
import {
  FakeGeneratedImageRepository,
  FakeImageStorage,
  FakeUserServiceClient,
  FakeImageGenerator,
  FakePromptGenerator,
} from './fakes.js';

const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';
const TEST_USER_ID = 'test-user-123';

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let fakeStorage: FakeImageStorage;
  let fakeRepo: FakeGeneratedImageRepository;
  let fakeUserClient: FakeUserServiceClient;
  let fakeGenerator: FakeImageGenerator;
  let fakePromptGenerator: FakePromptGenerator;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = TEST_INTERNAL_TOKEN;

    fakeStorage = new FakeImageStorage();
    fakeRepo = new FakeGeneratedImageRepository();
    fakeUserClient = new FakeUserServiceClient();
    fakeGenerator = new FakeImageGenerator();
    fakePromptGenerator = new FakePromptGenerator();

    const services: ServiceContainer = {
      generatedImageRepository: fakeRepo,
      imageStorage: fakeStorage,
      userServiceClient: fakeUserClient,
      createPromptGenerator: () => fakePromptGenerator,
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
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('POST /internal/images/prompts/generate', () => {
    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'gpt-4.1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when X-Internal-Auth header has wrong value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'gpt-4.1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when text is too short', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          text: 'short',
          model: 'gpt-4.1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when model is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'invalid-model',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when userId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'gpt-4.1',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 502 when user service fails', async () => {
      fakeUserClient.setFailNext(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'gpt-4.1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it('returns 400 when user has no API key for the provider', async () => {
      fakeUserClient.setApiKeys({});

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'gpt-4.1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload) as { error: { message: string } };
      expect(body.error.message).toContain('openai');
    });

    it('returns 429 when LLM is rate limited', async () => {
      fakeUserClient.setApiKeys({ openai: 'test-key' });
      fakePromptGenerator.setFailNext(true, 'RATE_LIMITED');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'gpt-4.1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(429);
    });

    it('returns 502 when LLM fails with API error', async () => {
      fakeUserClient.setApiKeys({ openai: 'test-key' });
      fakePromptGenerator.setFailNext(true, 'API_ERROR');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'gpt-4.1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it('generates prompt successfully', async () => {
      fakeUserClient.setApiKeys({ openai: 'test-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'gpt-4.1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { success: boolean; data: { title: string } };
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Test Title');
    });

    it('generates prompt with gemini model', async () => {
      fakeUserClient.setApiKeys({ google: 'test-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/prompts/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          text: 'This is a test article about machine learning.',
          model: 'gemini-2.5-pro',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /internal/images/generate', () => {
    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/generate',
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'gpt-image-1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when X-Internal-Auth header has wrong value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'gpt-image-1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when prompt is too short', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          prompt: 'short',
          model: 'gpt-image-1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when model is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'invalid-model',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when userId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'gpt-image-1',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 502 when user service fails to get API keys', async () => {
      fakeUserClient.setFailNext(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'gpt-image-1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it('returns 400 when required API key is not configured', async () => {
      fakeUserClient.setApiKeys({});

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'gpt-image-1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { message: string } };
      expect(body.error.message).toContain('API key');
    });

    it('returns 502 when image generation fails', async () => {
      fakeUserClient.setApiKeys({ openai: 'test-openai-key' });
      fakeGenerator.setFailNext(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'gpt-image-1',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it('returns 500 and cleans up storage when DB save fails', async () => {
      fakeUserClient.setApiKeys({ openai: 'test-openai-key' });
      fakeRepo.setFailNextSave(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'gpt-image-1',
          userId: TEST_USER_ID,
        },
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
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'gpt-image-1',
          userId: TEST_USER_ID,
        },
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
        url: '/internal/images/generate',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          prompt: 'A beautiful sunset over mountains',
          model: 'gemini-2.5-flash-image',
          userId: TEST_USER_ID,
        },
      });

      expect(response.statusCode).toBe(200);
    });
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
        headers: { 'x-internal-auth': 'wrong-token' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async () => {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

      const response = await app.inject({
        method: 'DELETE',
        url: '/internal/images/image-123',
        headers: { 'x-internal-auth': 'any-token' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('deletes image successfully', async () => {
      fakeRepo.setImage(testImage);

      const response = await app.inject({
        method: 'DELETE',
        url: `/internal/images/${testImage.id}`,
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
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
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns success even when storage delete fails', async () => {
      fakeRepo.setImage(testImage);
      fakeStorage.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/internal/images/${testImage.id}`,
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns success even when repository delete fails', async () => {
      fakeRepo.setImage(testImage);
      fakeRepo.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/internal/images/${testImage.id}`,
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
