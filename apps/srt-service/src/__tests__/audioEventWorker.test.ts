/**
 * Tests for audio event worker.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAudioEventHandler } from '../workers/audioEventWorker.js';
import { FakeJobRepository, FakeSpeechmaticsClient, FakeEventPublisher } from './fakes.js';
import { AudioStoredSubscriber } from '../infra/pubsub/index.js';
import type { AudioStoredEvent } from '../infra/pubsub/index.js';
import type { ServiceContainer } from '../services.js';
import type { WorkerLogger } from '../workers/index.js';
describe('Audio Event Worker', () => {
  let fakeJobRepo: FakeJobRepository;
  let services: ServiceContainer;
  let logger: WorkerLogger;
  beforeEach(() => {
    fakeJobRepo = new FakeJobRepository();
    services = {
      jobRepository: fakeJobRepo,
      speechmaticsClient: new FakeSpeechmaticsClient(),
      audioStoredSubscriber: new AudioStoredSubscriber('test-project', 'test-subscription'),
      eventPublisher: new FakeEventPublisher(),
    };
    logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
  });
  describe('createAudioEventHandler', () => {
    it('creates a transcription job for new audio event', async () => {
      const handler = createAudioEventHandler(services, logger);
      const event: AudioStoredEvent = {
        type: 'whatsapp.audio.stored',
        userId: 'user-123',
        messageId: 'msg-456',
        mediaId: 'media-789',
        gcsPath: 'whatsapp/user-123/msg-456/media-789.ogg',
        mimeType: 'audio/ogg',
        timestamp: new Date().toISOString(),
      };
      await handler(event);
      const jobs = fakeJobRepo.getAll();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.messageId).toBe('msg-456');
      expect(jobs[0]?.mediaId).toBe('media-789');
      expect(jobs[0]?.userId).toBe('user-123');
      expect(jobs[0]?.status).toBe('pending');
    });
    it('returns without error for duplicate event (idempotent)', async () => {
      const handler = createAudioEventHandler(services, logger);
      const event: AudioStoredEvent = {
        type: 'whatsapp.audio.stored',
        userId: 'user-123',
        messageId: 'msg-duplicate',
        mediaId: 'media-duplicate',
        gcsPath: 'whatsapp/user-123/msg-duplicate/media-duplicate.ogg',
        mimeType: 'audio/ogg',
        timestamp: new Date().toISOString(),
      };
      // Process same event twice
      await handler(event);
      await handler(event);
      // Should still only have one job
      const jobs = fakeJobRepo.getAll();
      expect(jobs).toHaveLength(1);
    });
    it('only creates one job for duplicate event', async () => {
      const handler = createAudioEventHandler(services, logger);
      const event: AudioStoredEvent = {
        type: 'whatsapp.audio.stored',
        userId: 'user-123',
        messageId: 'msg-idempotent-test',
        mediaId: 'media-idempotent-test',
        gcsPath: 'whatsapp/user-123/msg-idempotent-test/media-idempotent-test.ogg',
        mimeType: 'audio/ogg',
        timestamp: new Date().toISOString(),
      };
      // First call creates job
      await handler(event);
      const firstJobs = fakeJobRepo.getAll();
      const firstJobId = firstJobs[0]?.id;
      // Second call should not create new job
      await handler(event);
      const secondJobs = fakeJobRepo.getAll();
      expect(secondJobs).toHaveLength(1);
      expect(secondJobs[0]?.id).toBe(firstJobId);
    });
  });
});
