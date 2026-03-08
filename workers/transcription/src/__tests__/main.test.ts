/**
 * Tests for the main transcription orchestration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transcribeAudio, type TranscriptionDeps } from '../main.js';
import type { AudioStoredEvent, TranscriptionCompletedEvent } from '../types.js';
import type { SpeechTranscriptionPort } from '../providers/transcription-provider.js';
import { ok, err } from '@intexuraos/common-core';

const mockLogger = {
  level: 'info',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const sampleEvent: AudioStoredEvent = {
  type: 'whatsapp.audio.stored',
  userId: 'user-123',
  messageId: 'msg-456',
  mediaId: 'media-789',
  gcsPath: 'whatsapp/user-123/msg-456/media-789.ogg',
  mimeType: 'audio/ogg',
  timestamp: '2024-01-01T00:00:00.000Z',
};

const noopSleep = (): Promise<void> => Promise.resolve();

function makeProvider(
  submitResponse: Awaited<ReturnType<SpeechTranscriptionPort['submitJob']>>,
  pollResponses: Awaited<ReturnType<SpeechTranscriptionPort['pollJob']>>[],
  transcriptResponse: Awaited<ReturnType<SpeechTranscriptionPort['getTranscript']>>
): SpeechTranscriptionPort {
  let pollIndex = 0;
  return {
    submitJob: vi.fn().mockResolvedValue(submitResponse),
    pollJob: vi.fn().mockImplementation(() => {
      const response = pollResponses[pollIndex];
      pollIndex++;
      return Promise.resolve(
        response ??
          ok({ status: 'running', apiCall: { timestamp: '', operation: 'poll', success: true } })
      );
    }),
    getTranscript: vi.fn().mockResolvedValue(transcriptResponse),
  };
}

function makeSuccessProvider(): SpeechTranscriptionPort {
  return makeProvider(
    ok({ jobId: 'job-123', apiCall: { timestamp: '', operation: 'submit', success: true } }),
    [ok({ status: 'done', apiCall: { timestamp: '', operation: 'poll', success: true } })],
    ok({
      text: 'Hello world',
      apiCall: { timestamp: '', operation: 'fetch_result', success: true },
    })
  );
}

describe('transcribeAudio', () => {
  let publishedEvents: TranscriptionCompletedEvent[];
  let deps: TranscriptionDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    publishedEvents = [];

    deps = {
      fetchUserProvider: vi.fn().mockResolvedValue('speechmatics'),
      generateSignedUrl: vi.fn().mockResolvedValue(ok('https://storage.example.com/audio.ogg')),
      createProvider: vi.fn().mockReturnValue(makeSuccessProvider()),
      publishEvent: vi.fn().mockImplementation((event: TranscriptionCompletedEvent) => {
        publishedEvents.push(event);
        return Promise.resolve(ok(undefined));
      }),
      pollConfig: {
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
        maxAttempts: 5,
      },
      sleep: noopSleep,
    };
  });

  describe('happy path', () => {
    it('publishes completed event on successful transcription', async () => {
      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents).toHaveLength(1);
      const event = publishedEvents[0];
      expect(event?.type).toBe('srt.transcription.completed');
      expect(event?.userId).toBe('user-123');
      expect(event?.messageId).toBe('msg-456');
      expect(event?.status).toBe('completed');
      expect(event?.transcript).toBe('Hello world');
    });

    it('includes summary in completed event when provider returns one', async () => {
      const provider = makeProvider(
        ok({ jobId: 'job-123', apiCall: { timestamp: '', operation: 'submit', success: true } }),
        [ok({ status: 'done', apiCall: { timestamp: '', operation: 'poll', success: true } })],
        ok({
          text: 'Hello',
          summary: 'A summary',
          apiCall: { timestamp: '', operation: 'fetch_result', success: true },
        })
      );
      deps.createProvider = vi.fn().mockReturnValue(provider);

      await transcribeAudio(sampleEvent, deps, mockLogger);

      const event = publishedEvents[0];
      expect(event?.summary).toBe('A summary');
    });

    it('includes detectedLanguage in completed event when provider returns one', async () => {
      const provider = makeProvider(
        ok({ jobId: 'job-123', apiCall: { timestamp: '', operation: 'submit', success: true } }),
        [ok({ status: 'done', apiCall: { timestamp: '', operation: 'poll', success: true } })],
        ok({
          text: 'Cześć',
          detectedLanguage: 'pl',
          apiCall: { timestamp: '', operation: 'fetch_result', success: true },
        })
      );
      deps.createProvider = vi.fn().mockReturnValue(provider);

      await transcribeAudio(sampleEvent, deps, mockLogger);

      const event = publishedEvents[0];
      expect(event?.detectedLanguage).toBe('pl');
    });

    it('uses the provider from user settings', async () => {
      deps.fetchUserProvider = vi.fn().mockResolvedValue('custom-provider');

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(deps.createProvider).toHaveBeenCalledWith('custom-provider');
    });

    it('calls generateSignedUrl with correct gcsPath', async () => {
      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(deps.generateSignedUrl).toHaveBeenCalledWith(
        'whatsapp/user-123/msg-456/media-789.ogg'
      );
    });
  });

  describe('error cases', () => {
    it('publishes failed event when signed URL generation fails', async () => {
      deps.generateSignedUrl = vi.fn().mockResolvedValue(err({ message: 'GCS access denied' }));

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.status).toBe('failed');
      expect(publishedEvents[0]?.error).toContain('GCS access denied');
    });

    it('publishes failed event when job submission fails', async () => {
      const provider = makeProvider(
        err({ code: 'SPEECHMATICS_SUBMIT_ERROR', message: 'API key invalid' }),
        [],
        ok({ text: '', apiCall: { timestamp: '', operation: 'fetch_result', success: true } })
      );
      deps.createProvider = vi.fn().mockReturnValue(provider);

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.status).toBe('failed');
    });

    it('publishes failed event when polling times out', async () => {
      const provider = makeProvider(
        ok({ jobId: 'job-123', apiCall: { timestamp: '', operation: 'submit', success: true } }),
        [
          ok({ status: 'running', apiCall: { timestamp: '', operation: 'poll', success: true } }),
          ok({ status: 'running', apiCall: { timestamp: '', operation: 'poll', success: true } }),
          ok({ status: 'running', apiCall: { timestamp: '', operation: 'poll', success: true } }),
        ],
        ok({ text: '', apiCall: { timestamp: '', operation: 'fetch_result', success: true } })
      );
      deps.createProvider = vi.fn().mockReturnValue(provider);
      deps.pollConfig = { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 };

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.status).toBe('failed');
      expect(publishedEvents[0]?.error).toContain('timed out');
    });

    it('publishes failed event when job is rejected', async () => {
      const provider = makeProvider(
        ok({ jobId: 'job-123', apiCall: { timestamp: '', operation: 'submit', success: true } }),
        [
          ok({
            status: 'rejected',
            error: { code: 'AUDIO_TOO_SHORT', message: 'Audio is too short' },
            apiCall: { timestamp: '', operation: 'poll', success: true },
          }),
        ],
        ok({ text: '', apiCall: { timestamp: '', operation: 'fetch_result', success: true } })
      );
      deps.createProvider = vi.fn().mockReturnValue(provider);

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.status).toBe('failed');
    });

    it('publishes failed event when job is rejected without error details', async () => {
      const provider = makeProvider(
        ok({ jobId: 'job-123', apiCall: { timestamp: '', operation: 'submit', success: true } }),
        [
          ok({
            status: 'rejected',
            apiCall: { timestamp: '', operation: 'poll', success: true },
          }),
        ],
        ok({ text: '', apiCall: { timestamp: '', operation: 'fetch_result', success: true } })
      );
      deps.createProvider = vi.fn().mockReturnValue(provider);

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.status).toBe('failed');
    });

    it('publishes failed event when transcript fetch fails', async () => {
      const provider = makeProvider(
        ok({ jobId: 'job-123', apiCall: { timestamp: '', operation: 'submit', success: true } }),
        [ok({ status: 'done', apiCall: { timestamp: '', operation: 'poll', success: true } })],
        err({ code: 'SPEECHMATICS_TRANSCRIPT_ERROR', message: 'Failed to fetch' })
      );
      deps.createProvider = vi.fn().mockReturnValue(provider);

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.status).toBe('failed');
    });

    it('publishes failed event when unexpected error occurs', async () => {
      deps.generateSignedUrl = vi.fn().mockRejectedValue(new Error('Unexpected crash'));

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.status).toBe('failed');
      expect(publishedEvents[0]?.error).toContain('Unexpected crash');
    });

    it('logs error when publish itself fails', async () => {
      deps.publishEvent = vi
        .fn()
        .mockResolvedValue(err({ code: 'PUBLISH_FAILED', message: 'Topic not found' }));

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('logs error when failed event publish itself fails', async () => {
      deps.generateSignedUrl = vi.fn().mockResolvedValue(err({ message: 'GCS error' }));
      deps.publishEvent = vi
        .fn()
        .mockResolvedValue(err({ code: 'PUBLISH_FAILED', message: 'Topic not found' }));

      // Should not throw - just log the error
      await expect(transcribeAudio(sampleEvent, deps, mockLogger)).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('completed event structure', () => {
    it('sets correct event type', async () => {
      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents[0]?.type).toBe('srt.transcription.completed');
    });

    it('sets jobId from submit result', async () => {
      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents[0]?.jobId).toBe('job-123');
    });

    it('sets jobId to unknown on signed URL failure', async () => {
      deps.generateSignedUrl = vi.fn().mockResolvedValue(err({ message: 'error' }));

      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents[0]?.jobId).toBe('unknown');
    });

    it('does not include summary when undefined', async () => {
      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents[0]).not.toHaveProperty('summary');
    });

    it('does not include detectedLanguage when undefined', async () => {
      await transcribeAudio(sampleEvent, deps, mockLogger);

      expect(publishedEvents[0]).not.toHaveProperty('detectedLanguage');
    });
  });
});
