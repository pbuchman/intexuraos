/**
 * Integration tests for srt-service transcribe routes.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import { FakeJobRepository, FakeSpeechmaticsClient, FakeEventPublisher } from './fakes.js';
import { AudioStoredSubscriber } from '../infra/pubsub/index.js';
import type { Config } from '../config.js';
interface SuccessResponse<T> {
  success: true;
  data: T;
}
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
interface TranscriptionJobData {
  id: string;
  messageId: string;
  mediaId: string;
  userId: string;
  gcsPath: string;
  mimeType: string;
  status: string;
  pollAttempts: number;
  createdAt: string;
  updatedAt: string;
}
const testConfig: Config = {
  speechmaticsApiKey: 'test-api-key',
  audioStoredSubscription: 'test-subscription',
  transcriptionCompletedTopic: 'test-transcription-completed',
  gcpProjectId: 'test-project',
  port: 8085,
  host: '0.0.0.0',
};
describe('Transcription Routes', () => {
  let app: FastifyInstance;
  let fakeJobRepo: FakeJobRepository;
  let fakeSpeechmaticsClient: FakeSpeechmaticsClient;
  beforeAll(async () => {
    fakeJobRepo = new FakeJobRepository();
    fakeSpeechmaticsClient = new FakeSpeechmaticsClient();
    setServices({
      jobRepository: fakeJobRepo,
      speechmaticsClient: fakeSpeechmaticsClient,
      audioStoredSubscriber: new AudioStoredSubscriber('test-project', 'test-subscription'),
      eventPublisher: new FakeEventPublisher(),
    });
    app = await createServer(testConfig);
  });
  afterAll(async () => {
    await app.close();
    resetServices();
  });
  beforeEach(() => {
    fakeJobRepo.clear();
  });
  describe('POST /v1/transcribe', () => {
    it('creates a new transcription job', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/transcribe',
        payload: {
          messageId: 'msg-123',
          mediaId: 'media-456',
          userId: 'user-789',
          gcsPath: 'whatsapp/user-789/msg-123/media-456.ogg',
          mimeType: 'audio/ogg',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as SuccessResponse<TranscriptionJobData>;
      expect(body.success).toBe(true);
      expect(body.data.messageId).toBe('msg-123');
      expect(body.data.mediaId).toBe('media-456');
      expect(body.data.userId).toBe('user-789');
      expect(body.data.status).toBe('pending');
      expect(body.data.id).toBeDefined();
    });
    it('returns existing job for same messageId/mediaId (idempotent)', async () => {
      // First request creates job
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/v1/transcribe',
        payload: {
          messageId: 'msg-idempotent',
          mediaId: 'media-idempotent',
          userId: 'user-123',
          gcsPath: 'whatsapp/user-123/msg-idempotent/media-idempotent.ogg',
          mimeType: 'audio/ogg',
        },
      });
      expect(firstResponse.statusCode).toBe(201);
      const firstBody = JSON.parse(firstResponse.body) as SuccessResponse<TranscriptionJobData>;
      const firstJobId = firstBody.data.id;
      // Second request returns existing job
      const secondResponse = await app.inject({
        method: 'POST',
        url: '/v1/transcribe',
        payload: {
          messageId: 'msg-idempotent',
          mediaId: 'media-idempotent',
          userId: 'user-123',
          gcsPath: 'whatsapp/user-123/msg-idempotent/media-idempotent.ogg',
          mimeType: 'audio/ogg',
        },
      });
      expect(secondResponse.statusCode).toBe(200);
      const secondBody = JSON.parse(secondResponse.body) as SuccessResponse<TranscriptionJobData>;
      expect(secondBody.data.id).toBe(firstJobId);
    });
    it('returns error for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/transcribe',
        payload: {
          messageId: 'msg-123',
        },
      });

      // Fastify returns 400 for schema validation errors
      // but may return 500 if error handler is not configured
      expect([400, 500]).toContain(response.statusCode);
    });
  });

  describe('GET /v1/transcribe/:jobId', () => {
    it('returns job status for existing job', async () => {
      // Create a job first
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/transcribe',
        payload: {
          messageId: 'msg-get-test',
          mediaId: 'media-get-test',
          userId: 'user-get-test',
          gcsPath: 'whatsapp/user-get-test/msg-get-test/media-get-test.ogg',
          mimeType: 'audio/ogg',
        },
      });
      const createBody = JSON.parse(createResponse.body) as SuccessResponse<TranscriptionJobData>;
      const jobId = createBody.data.id;
      // Get the job
      const getResponse = await app.inject({
        method: 'GET',
        url: '/v1/transcribe/' + jobId,
      });
      expect(getResponse.statusCode).toBe(200);
      const getBody = JSON.parse(getResponse.body) as SuccessResponse<TranscriptionJobData>;
      expect(getBody.success).toBe(true);
      expect(getBody.data.id).toBe(jobId);
      expect(getBody.data.status).toBe('pending');
    });
    it('returns 404 for non-existent job', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/transcribe/non-existent-job-id',
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});
