/**
 * Tests for TranscribeAudioUseCase.
 *
 * Tests the complete audio transcription workflow:
 * - Get signed URL for audio file
 * - Submit job to transcription service
 * - Poll until completion
 * - Fetch transcript
 * - Update message with transcription
 * - Send result to user via WhatsApp
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaStoragePort } from '../../domain/whatsapp/index.js';
import {
  type TranscribeAudioDeps,
  type TranscribeAudioInput,
  type TranscribeAudioLogger,
  TranscribeAudioUseCase,
  type TranscriptionPollingConfig,
} from '../../domain/whatsapp/index.js';
import {
  FakeEventPublisher,
  FakeMediaStorage,
  FakeSpeechTranscriptionPort,
  FakeWhatsAppCloudApiPort,
  FakeWhatsAppMessageRepository,
} from '../fakes.js';

/**
 * Create a no-op logger for tests.
 */
function createTestLogger(): TranscribeAudioLogger {
  return {
    info: (_data: Record<string, unknown>, _message: string): void => {
      // No-op logger for tests
    },
    error: (_data: Record<string, unknown>, _message: string): void => {
      // No-op logger for tests
    },
  };
}

/**
 * Create standard test input.
 */
function createTestInput(overrides?: Partial<TranscribeAudioInput>): TranscribeAudioInput {
  return {
    messageId: 'test-message-id',
    userId: 'test-user-id',
    gcsPath: 'whatsapp/test-user-id/msg123/audio.ogg',
    mimeType: 'audio/ogg',
    userPhoneNumber: '48123456789',
    originalWaMessageId: 'wamid.original123',
    phoneNumberId: '123456789012345',
    ...overrides,
  };
}

/**
 * Fast polling config for tests.
 */
const fastPollingConfig: TranscriptionPollingConfig = {
  initialDelayMs: 1, // Very short for tests
  maxDelayMs: 10,
  backoffMultiplier: 1.5,
  maxAttempts: 5,
};

describe('TranscribeAudioUseCase', () => {
  let messageRepository: FakeWhatsAppMessageRepository;
  let mediaStorage: FakeMediaStorage;
  let transcriptionService: FakeSpeechTranscriptionPort;
  let whatsappCloudApi: FakeWhatsAppCloudApiPort;
  let usecase: TranscribeAudioUseCase;
  let deps: TranscribeAudioDeps;
  let logger: TranscribeAudioLogger;

  beforeEach(() => {
    messageRepository = new FakeWhatsAppMessageRepository();
    mediaStorage = new FakeMediaStorage();
    transcriptionService = new FakeSpeechTranscriptionPort();
    whatsappCloudApi = new FakeWhatsAppCloudApiPort();
    logger = createTestLogger();

    deps = {
      messageRepository,
      mediaStorage,
      transcriptionService,
      whatsappCloudApi,
    };

    usecase = new TranscribeAudioUseCase(deps, fastPollingConfig);
  });

  /**
   * Helper to create a message in the repository for testing.
   */
  async function createTestMessage(messageId: string, userId: string): Promise<void> {
    // Create a message via the repository
    const result = await messageRepository.saveMessage({
      userId,
      waMessageId: 'wamid.original123',
      fromNumber: '48123456789',
      toNumber: '48987654321',
      text: '',
      mediaType: 'audio',
      media: { id: 'media-123', mimeType: 'audio/ogg', fileSize: 5000 },
      gcsPath: 'whatsapp/test-user-id/msg123/audio.ogg',
      timestamp: '1703673600',
      receivedAt: new Date().toISOString(),
      webhookEventId: 'event-123',
    });

    // The fake generates a random ID, so we need to patch the message to use our test ID
    if (result.ok) {
      const messages = messageRepository.getAll();
      const message = messages[0];
      if (message !== undefined) {
        // Replace in internal map
        (messageRepository as unknown as { messages: Map<string, unknown> }).messages.delete(
          message.id
        );
        (messageRepository as unknown as { messages: Map<string, unknown> }).messages.set(
          messageId,
          {
            ...message,
            id: messageId,
          }
        );
      }
    }
  }

  describe('happy path', () => {
    it('transcribes audio successfully', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      // Setup: Job will complete on first poll
      const input = createTestInput();

      // Execute in a way that lets us set the job result
      const executePromise = usecase.execute(input, logger);

      // Give time for job to be submitted
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the job ID and set it as done
      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        transcriptionService.setJobResult(jobId, 'This is the transcribed text.');
      }

      await executePromise;

      // Verify transcription was saved
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('completed');
        expect(message.value.transcription?.text).toBe('This is the transcribed text.');
      }

      // Verify WhatsApp message was sent
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(lastMessage?.message).toContain('Transcription');
      expect(lastMessage?.message).toContain('This is the transcribed text.');
    });
  });

  describe('error handling', () => {
    it('handles signed URL error', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      // Create a custom media storage that fails on getSignedUrl
      const failingMediaStorage: MediaStoragePort = {
        upload: mediaStorage.upload.bind(mediaStorage),
        uploadThumbnail: mediaStorage.uploadThumbnail.bind(mediaStorage),
        delete: mediaStorage.delete.bind(mediaStorage),
        getSignedUrl: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to generate signed URL' },
        }),
      };

      const failingDeps: TranscribeAudioDeps = {
        messageRepository,
        mediaStorage: failingMediaStorage,
        transcriptionService,
        whatsappCloudApi,
      };

      const failingUsecase = new TranscribeAudioUseCase(failingDeps, fastPollingConfig);

      await failingUsecase.execute(createTestInput(), logger);

      // Verify transcription state is failed
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
        expect(message.value.transcription?.error?.code).toBe('SIGNED_URL_ERROR');
      }

      // Verify failure message was sent to user
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(lastMessage?.message).toContain('failed');
    });

    it('handles job submission failure', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      transcriptionService.setFailMode(true, 'API rate limit exceeded');

      await usecase.execute(createTestInput(), logger);

      // Verify transcription state is failed
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
      }

      // Verify failure message was sent to user
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(lastMessage?.message).toContain('failed');
    });

    it('handles job submission failure without apiCall in error', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      // Configure to fail without apiCall in the error response
      transcriptionService.setFailMode(true, 'Network error', true);

      await usecase.execute(createTestInput(), logger);

      // Verify transcription state is failed
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
        // lastApiCall should not be set since error didn't include apiCall
        expect(message.value.transcription?.lastApiCall).toBeUndefined();
      }

      // Verify failure message was sent to user
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
    });

    it('handles job rejection', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      const input = createTestInput();

      // Execute in a way that lets us reject the job
      const executePromise = usecase.execute(input, logger);

      // Give time for job to be submitted
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the job ID and reject it
      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        transcriptionService.setJobFailed(jobId, 'Invalid audio format');
      }

      await executePromise;

      // Verify transcription state is failed
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
        expect(message.value.transcription?.error?.code).toBe('JOB_REJECTED');
      }

      // Verify failure message was sent to user
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
    });

    it('handles job rejection without error details', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      const input = createTestInput();

      // Execute in a way that lets us reject the job without error
      const executePromise = usecase.execute(input, logger);

      // Give time for job to be submitted
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the job ID and reject it without an error message
      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        transcriptionService.setJobRejectedWithoutError(jobId);
      }

      await executePromise;

      // Verify transcription state is failed with default error
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
        // When no error provided, use default 'JOB_REJECTED' message
        expect(message.value.transcription?.error?.code).toBe('JOB_REJECTED');
        expect(message.value.transcription?.error?.message).toBe('Job was rejected');
      }

      // Verify failure message was sent to user with default message
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(lastMessage?.message).toContain('Job was rejected');
    });

    it('handles polling timeout', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      // Use a very short timeout config
      const timeoutConfig: TranscriptionPollingConfig = {
        initialDelayMs: 1,
        maxDelayMs: 1,
        backoffMultiplier: 1,
        maxAttempts: 2, // Only 2 attempts = quick timeout
      };

      const timeoutUsecase = new TranscribeAudioUseCase(deps, timeoutConfig);

      // Job will never complete, so it should timeout
      await timeoutUsecase.execute(createTestInput(), logger);

      // Verify transcription state is failed with timeout
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
        expect(message.value.transcription?.error?.code).toBe('POLL_TIMEOUT');
      }

      // Verify failure message was sent to user
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(lastMessage?.message).toContain('timed out');
    });

    it('retries on transient poll errors then succeeds', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      // Use a longer polling config to allow for retry testing
      const retryTestConfig: TranscriptionPollingConfig = {
        initialDelayMs: 1,
        maxDelayMs: 5,
        backoffMultiplier: 1.5,
        maxAttempts: 10, // Enough attempts for retry + success
      };

      const retryUsecase = new TranscribeAudioUseCase(deps, retryTestConfig);

      // Configure: first poll fails with transient error, then succeeds
      transcriptionService.setPollFailures(1);

      const input = createTestInput();

      // Execute in a way that lets us set the job result
      const executePromise = retryUsecase.execute(input, logger);

      // Give time for job to be submitted and first poll to fail
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the job ID and set it as done (so next poll succeeds)
      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        transcriptionService.setJobResult(jobId, 'Transcribed after retry.');
      }

      await executePromise;

      // Verify transcription was saved successfully (retry worked)
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('completed');
        expect(message.value.transcription?.text).toBe('Transcribed after retry.');
      }

      // Verify success message was sent
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(lastMessage?.message).toContain('Transcription');
      expect(lastMessage?.message).toContain('Transcribed after retry.');
    });

    it('handles service unavailable (503) response', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      // Configure: all polls fail with 503 service unavailable
      // Use more failures than max attempts to ensure timeout
      transcriptionService.setPollFailures(10, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable (503)',
      });

      // Use short timeout config to speed up test
      const shortTimeoutConfig: TranscriptionPollingConfig = {
        initialDelayMs: 1,
        maxDelayMs: 1,
        backoffMultiplier: 1,
        maxAttempts: 3, // Will exhaust retries
      };

      const shortTimeoutUsecase = new TranscribeAudioUseCase(deps, shortTimeoutConfig);

      await shortTimeoutUsecase.execute(createTestInput(), logger);

      // Verify transcription state is failed with timeout (retries exhausted)
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
        expect(message.value.transcription?.error?.code).toBe('POLL_TIMEOUT');
      }

      // Verify failure message was sent to user
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
    });

    it('handles unexpected error', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      // Create a custom media storage that throws unexpected error
      const throwingMediaStorage: MediaStoragePort = {
        upload: mediaStorage.upload.bind(mediaStorage),
        uploadThumbnail: mediaStorage.uploadThumbnail.bind(mediaStorage),
        delete: mediaStorage.delete.bind(mediaStorage),
        getSignedUrl: vi.fn().mockRejectedValue(new Error('Unexpected network failure')),
      };

      const throwingDeps: TranscribeAudioDeps = {
        messageRepository,
        mediaStorage: throwingMediaStorage,
        transcriptionService,
        whatsappCloudApi,
      };

      const throwingUsecase = new TranscribeAudioUseCase(throwingDeps, fastPollingConfig);

      await throwingUsecase.execute(createTestInput(), logger);

      // Verify transcription state is failed
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
        expect(message.value.transcription?.error?.code).toBe('UNEXPECTED_ERROR');
      }

      // Verify failure message was sent to user
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
    });

    it('handles unexpected error that is not an Error instance', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      // Create a custom media storage that throws a non-Error value
      const throwingMediaStorage: MediaStoragePort = {
        upload: mediaStorage.upload.bind(mediaStorage),
        uploadThumbnail: mediaStorage.uploadThumbnail.bind(mediaStorage),
        delete: mediaStorage.delete.bind(mediaStorage),
        getSignedUrl: vi.fn().mockRejectedValue('String error thrown'),
      };

      const throwingDeps: TranscribeAudioDeps = {
        messageRepository,
        mediaStorage: throwingMediaStorage,
        transcriptionService,
        whatsappCloudApi,
      };

      const throwingUsecase = new TranscribeAudioUseCase(throwingDeps, fastPollingConfig);

      await throwingUsecase.execute(createTestInput(), logger);

      // Verify transcription state is failed with 'Unknown error' message
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
        expect(message.value.transcription?.error?.code).toBe('UNEXPECTED_ERROR');
        expect(message.value.transcription?.error?.message).toBe('Unknown error');
      }

      // Verify failure message was sent to user with 'Unknown error'
      const sentMessages = whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(lastMessage?.message).toContain('Unknown error');
    });

    it('handles transcript fetch failure after job completion', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      const input = createTestInput();

      // Execute in a way that lets us set the job as done but fail transcript fetch
      const executePromise = usecase.execute(input, logger);

      // Give time for job to be submitted
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the job ID and set it as done (but don't set transcript)
      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        // Mark as done but don't set transcript - getTranscript will fail
        const job = jobs.get(jobId);
        if (job !== undefined) {
          job.status = 'done';
          // transcript is undefined, so getTranscript will return NOT_FOUND error
        }
      }

      await executePromise;

      // Verify transcription state is failed
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
      }
    });

    it('handles transcript fetch failure without apiCall in error', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      // Configure getTranscript to return error without apiCall
      transcriptionService.setGetTranscriptWithoutApiCall(true);

      const input = createTestInput();

      // Execute in a way that lets us set the job as done but fail transcript fetch
      const executePromise = usecase.execute(input, logger);

      // Give time for job to be submitted
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the job ID and set it as done (but don't set transcript)
      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        // Mark as done but don't set transcript - getTranscript will fail
        const job = jobs.get(jobId);
        if (job !== undefined) {
          job.status = 'done';
        }
      }

      await executePromise;

      // Verify transcription state is failed
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('failed');
        // lastApiCall should not be set since error didn't include apiCall
        expect(message.value.transcription?.lastApiCall).toBeUndefined();
      }
    });
  });

  describe('message sending', () => {
    it('sends success message with transcript', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      const input = createTestInput();
      const executePromise = usecase.execute(input, logger);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        transcriptionService.setJobResult(jobId, 'Hello world transcription');
      }

      await executePromise;

      const sentMessages = whatsappCloudApi.getSentMessages();
      const successMessage = sentMessages.find((m) => m.message.includes('🎙️'));
      expect(successMessage).toBeDefined();
      expect(successMessage?.message).toContain('Hello world transcription');
      expect(successMessage?.replyToMessageId).toBe('wamid.original123');
    });

    it('sends success message with transcript and summary with English intro phrase', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      const input = createTestInput();
      const executePromise = usecase.execute(input, logger);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        transcriptionService.setJobResult(
          jobId,
          'Create a todo for reviewing the PR',
          'User wants to create a new todo for reviewing PR 445',
          'en'
        );
      }

      await executePromise;

      const sentMessages = whatsappCloudApi.getSentMessages();
      const successMessage = sentMessages.find((m) => m.message.includes('🎙️'));
      expect(successMessage).toBeDefined();
      expect(successMessage?.message).toContain('Create a todo for reviewing the PR');
      expect(successMessage?.message).toContain('📝 *Summary:*');
      expect(successMessage?.message).toContain('Here is a summary of what you said:');
      expect(successMessage?.message).toContain('User wants to create a new todo');
    });

    it('sends success message with Polish intro phrase when detected language is Polish', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      const input = createTestInput();
      const executePromise = usecase.execute(input, logger);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        transcriptionService.setJobResult(
          jobId,
          'Utwórz zadanie do przejrzenia PR',
          'Użytkownik chce utworzyć nowe zadanie do przejrzenia PR 445',
          'pl'
        );
      }

      await executePromise;

      const sentMessages = whatsappCloudApi.getSentMessages();
      const successMessage = sentMessages.find((m) => m.message.includes('🎙️'));
      expect(successMessage).toBeDefined();
      expect(successMessage?.message).toContain('Utwórz zadanie do przejrzenia PR');
      expect(successMessage?.message).toContain('📝 *Summary:*');
      expect(successMessage?.message).toContain('Oto podsumowanie tego, co powiedziałeś:');
      expect(successMessage?.message).toContain('Użytkownik chce utworzyć nowe zadanie');
    });

    it('sends success message without summary section when summary is not available', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      const input = createTestInput();
      const executePromise = usecase.execute(input, logger);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        // Set result without summary
        transcriptionService.setJobResult(jobId, 'Transcript without summary');
      }

      await executePromise;

      const sentMessages = whatsappCloudApi.getSentMessages();
      const successMessage = sentMessages.find((m) => m.message.includes('🎙️'));
      expect(successMessage).toBeDefined();
      expect(successMessage?.message).toContain('Transcript without summary');
      expect(successMessage?.message).not.toContain('📝 *Summary:*');
    });

    it('sends failure message with error details', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      transcriptionService.setFailMode(true, 'Audio file corrupted');

      await usecase.execute(createTestInput(), logger);

      const sentMessages = whatsappCloudApi.getSentMessages();
      const failureMessage = sentMessages.find((m) => m.message.includes('❌'));
      expect(failureMessage).toBeDefined();
      expect(failureMessage?.message).toContain('Audio file corrupted');
    });
  });

  describe('event publishing', () => {
    it('publishes command ingest event after successful transcription', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      const fakeEventPublisher = new FakeEventPublisher();
      const depsWithPublisher: TranscribeAudioDeps = {
        ...deps,
        eventPublisher: fakeEventPublisher,
      };
      const usecaseWithPublisher = new TranscribeAudioUseCase(depsWithPublisher, fastPollingConfig);

      const input = createTestInput();
      const executePromise = usecaseWithPublisher.execute(input, logger);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        transcriptionService.setJobResult(jobId, 'Voice transcription result');
      }

      await executePromise;

      const events = fakeEventPublisher.getCommandIngestEvents();
      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe('command.ingest');
      expect(events[0]?.sourceType).toBe('whatsapp_voice');
      expect(events[0]?.text).toBe('Voice transcription result');
    });

    it('handles event publish failure gracefully', async () => {
      await createTestMessage('test-message-id', 'test-user-id');

      const fakeEventPublisher: TranscribeAudioDeps['eventPublisher'] = {
        publishMediaCleanup: vi.fn().mockResolvedValue({ ok: true }),
        publishCommandIngest: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Publish failed' },
        }),
        publishWebhookProcess: vi.fn().mockResolvedValue({ ok: true }),
        publishTranscribeAudio: vi.fn().mockResolvedValue({ ok: true }),
        publishExtractLinkPreviews: vi.fn().mockResolvedValue({ ok: true }),
      };
      const depsWithPublisher: TranscribeAudioDeps = {
        ...deps,
        eventPublisher: fakeEventPublisher,
      };
      const usecaseWithPublisher = new TranscribeAudioUseCase(depsWithPublisher, fastPollingConfig);

      const input = createTestInput();
      const executePromise = usecaseWithPublisher.execute(input, logger);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const jobs = transcriptionService.getJobs();
      const jobId = Array.from(jobs.keys())[0];
      if (jobId !== undefined) {
        transcriptionService.setJobResult(jobId, 'Voice transcription result');
      }

      await executePromise;

      // Transcription should still be successful despite publish failure
      const message = await messageRepository.findById('test-user-id', 'test-message-id');
      expect(message.ok).toBe(true);
      if (message.ok && message.value !== null) {
        expect(message.value.transcription?.status).toBe('completed');
      }
    });
  });
});
