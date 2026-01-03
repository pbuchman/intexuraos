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

describe('promptRoutes', () => {
  let fakeRepo: FakeGeneratedImageRepository;
  let fakeImageGenerator: FakeImageGenerator;
  let fakePromptGenerator: FakePromptGenerator;
  let fakeUserServiceClient: FakeUserServiceClient;

  beforeEach(() => {
    fakeRepo = new FakeGeneratedImageRepository();
    fakeImageGenerator = new FakeImageGenerator();
    fakePromptGenerator = new FakePromptGenerator();
    fakeUserServiceClient = new FakeUserServiceClient();

    fakeUserServiceClient.setApiKeys({
      google: 'test-google-key',
      openai: 'test-openai-key',
    });

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

  describe('POST /prompts/generate', () => {
    it('generates a thumbnail prompt from text', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'This is a test article about machine learning and its impact on modern technology. It covers various topics including neural networks, deep learning, and artificial intelligence applications.',
          model: 'gpt-4.1',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Test Title');
      expect(body.data.visualSummary).toBe('A test visual summary');
      expect(body.data.prompt).toBeDefined();
      expect(body.data.negativePrompt).toBeDefined();
      expect(body.data.parameters.aspectRatio).toBe('16:9');
    });

    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        payload: {
          text: 'Some content here that needs to be converted to a thumbnail prompt.',
          model: 'gpt-4.1',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('validates text length minimum', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'short',
          model: 'gpt-4.1',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates required model field', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'This is a test article about machine learning and its impact on modern technology.',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates model is in allowed list', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'This is a test article about machine learning and its impact on modern technology.',
          model: 'invalid-model',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 502 when user service fails', async () => {
      const app = await buildServer();
      fakeUserServiceClient.setFailNext(true, 'API_ERROR');

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'This is a test article about machine learning and its impact on modern technology.',
          model: 'gpt-4.1',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 400 when user has no API key for the provider', async () => {
      const app = await buildServer();
      fakeUserServiceClient.setApiKeys({});

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'This is a test article about machine learning and its impact on modern technology.',
          model: 'gpt-4.1',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('No openai API key');
    });

    it('returns 429 when LLM is rate limited', async () => {
      const app = await buildServer();
      fakePromptGenerator.setFailNext(true, 'RATE_LIMITED');

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'This is a test article about machine learning and its impact on modern technology.',
          model: 'gpt-4.1',
        },
      });

      expect(response.statusCode).toBe(429);
    });

    it('returns 502 when LLM fails with API error', async () => {
      const app = await buildServer();
      fakePromptGenerator.setFailNext(true, 'API_ERROR');

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'This is a test article about machine learning and its impact on modern technology.',
          model: 'gpt-4.1',
        },
      });

      expect(response.statusCode).toBe(502);
    });

    it('works with gemini-2.5-pro model', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'This is a test article about machine learning and its impact on modern technology.',
          model: 'gemini-2.5-pro',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('fails when google key is missing for gemini model', async () => {
      const app = await buildServer();
      fakeUserServiceClient.setApiKeys({ openai: 'key' });

      const response = await app.inject({
        method: 'POST',
        url: '/prompts/generate',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          text: 'This is a test article about machine learning and its impact on modern technology.',
          model: 'gemini-2.5-pro',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('google');
    });
  });
});
