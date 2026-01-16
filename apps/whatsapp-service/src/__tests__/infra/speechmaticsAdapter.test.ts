/**
 * Tests for SpeechmaticsTranscriptionAdapter.
 *
 * Tests the Speechmatics Batch API adapter for speech-to-text transcription.
 * Uses mocked BatchClient to test all code paths.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechmaticsTranscriptionAdapter } from '../../infra/speechmatics/adapter.js';

// Use vi.hoisted to define mocks before vi.mock is evaluated
const { mockCreateTranscriptionJob, mockGetJob, mockGetJobResult, constructorArgs } = vi.hoisted(
  () => {
    const mockCreateTranscriptionJob = vi.fn();
    const mockGetJob = vi.fn();
    const mockGetJobResult = vi.fn();
    const constructorArgs: unknown[] = [];

    return {
      mockCreateTranscriptionJob,
      mockGetJob,
      mockGetJobResult,
      constructorArgs,
    };
  }
);

// Mock the BatchClient from @speechmatics/batch-client
vi.mock('@speechmatics/batch-client', () => {
  // Define the mock class inside the factory function
  return {
    BatchClient: class MockBatchClient {
      constructor(options: unknown) {
        constructorArgs.push(options);
      }
      createTranscriptionJob = mockCreateTranscriptionJob;
      getJob = mockGetJob;
      getJobResult = mockGetJobResult;
    },
  };
});

// Mock pino logger to suppress console output
vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('SpeechmaticsTranscriptionAdapter', () => {
  let adapter: SpeechmaticsTranscriptionAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    constructorArgs.length = 0;
    adapter = new SpeechmaticsTranscriptionAdapter('test-api-key');
  });

  describe('constructor', () => {
    it('creates BatchClient with correct configuration', () => {
      expect(constructorArgs[0]).toEqual({
        apiKey: 'test-api-key',
        apiUrl: 'https://asr.api.speechmatics.com/v2',
        appId: 'intexuraos-whatsapp-service',
      });
    });
  });

  describe('submitJob', () => {
    it('returns job ID on success', async () => {
      mockCreateTranscriptionJob.mockResolvedValue({
        id: 'job-123',
      });

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
        language: 'en',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.jobId).toBe('job-123');
        expect(result.value.apiCall.operation).toBe('submit');
        expect(result.value.apiCall.success).toBe(true);
        expect(result.value.apiCall.response).toEqual({ jobId: 'job-123' });
      }

      const callArgs = mockCreateTranscriptionJob.mock.calls[0];
      if (callArgs === undefined) {
        throw new Error('mock was not called');
      }
      expect(callArgs[0]).toEqual({ url: 'https://storage.example.com/audio.ogg' });
      expect(callArgs[1]).toMatchObject({
        transcription_config: {
          language: 'en',
          operating_point: 'enhanced',
          additional_vocab: expect.any(Array),
        },
        summarization_config: {
          summary_type: 'bullets',
          summary_length: 'brief',
          content_type: 'auto',
        },
      });
    });

    it('uses auto language detection when language is not specified', async () => {
      mockCreateTranscriptionJob.mockResolvedValue({
        id: 'job-456',
      });

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      expect(result.ok).toBe(true);
      const callArgs = mockCreateTranscriptionJob.mock.calls[0];
      if (callArgs === undefined) {
        throw new Error('mock was not called');
      }
      expect(callArgs[1].transcription_config.language).toBe('auto');
    });

    it('includes IntexuraOS in additional vocabulary', async () => {
      mockCreateTranscriptionJob.mockResolvedValue({
        id: 'job-789',
      });

      await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      const callArgs = mockCreateTranscriptionJob.mock.calls[0];
      if (callArgs === undefined) {
        throw new Error('mock was not called');
      }
      const vocab = callArgs[1].transcription_config.additional_vocab;

      const intexuraEntry = vocab.find((v: { content: string }) => v.content === 'IntexuraOS');
      expect(intexuraEntry).toBeDefined();
      expect(intexuraEntry.sounds_like).toEqual(
        expect.arrayContaining(['in tex ura o s'])
      );
    });

    it('returns error when API call fails', async () => {
      mockCreateTranscriptionJob.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
        language: 'pl',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPEECHMATICS_SUBMIT_ERROR');
        expect(result.error.message).toBe('API rate limit exceeded');
        expect(result.error.apiCall?.operation).toBe('submit');
        expect(result.error.apiCall?.success).toBe(false);
      }
    });

    it('handles non-Error exceptions', async () => {
      mockCreateTranscriptionJob.mockRejectedValue('String error');

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPEECHMATICS_SUBMIT_ERROR');
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });

  describe('pollJob', () => {
    it('returns done status when job is complete', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'done',
        },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('done');
        expect(result.value.apiCall.operation).toBe('poll');
        expect(result.value.apiCall.success).toBe(true);
      }

      expect(mockGetJob).toHaveBeenCalledWith('job-123');
    });

    it('returns rejected status when job is rejected', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'rejected',
          errors: ['Invalid audio format', 'File too short'],
        },
      });

      const result = await adapter.pollJob('job-456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('rejected');
        expect(result.value.error?.code).toBe('JOB_REJECTED');
        expect(result.value.error?.message).toBe('Invalid audio format; File too short');
      }
    });

    it('returns rejected status with object errors', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'rejected',
          errors: [{ type: 'validation', detail: 'bad format' }],
        },
      });

      const result = await adapter.pollJob('job-456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('rejected');
        expect(result.value.error?.code).toBe('JOB_REJECTED');
        expect(result.value.error?.message).toBe('{"type":"validation","detail":"bad format"}');
      }
    });

    it('returns rejected status with string error value', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'rejected',
          errors: 'Single error string',
        },
      });

      const result = await adapter.pollJob('job-456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('rejected');
        expect(result.value.error?.code).toBe('JOB_REJECTED');
        expect(result.value.error?.message).toBe('Single error string');
      }
    });

    it('returns rejected status with non-string non-array error value', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'rejected',
          errors: { errorCode: 123 },
        },
      });

      const result = await adapter.pollJob('job-456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('rejected');
        expect(result.value.error?.code).toBe('JOB_REJECTED');
        expect(result.value.error?.message).toBe('{"errorCode":123}');
      }
    });

    it('returns running status for in-progress jobs', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'running',
        },
      });

      const result = await adapter.pollJob('job-789');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('running');
        expect(result.value.error).toBeUndefined();
      }
    });

    it('returns running status for queued jobs', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'queued',
        },
      });

      const result = await adapter.pollJob('job-abc');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('running');
      }
    });

    it('returns error when poll fails', async () => {
      mockGetJob.mockRejectedValue(new Error('Network timeout'));

      const result = await adapter.pollJob('job-xyz');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPEECHMATICS_POLL_ERROR');
        expect(result.error.message).toBe('Network timeout');
        expect(result.error.apiCall?.operation).toBe('poll');
        expect(result.error.apiCall?.success).toBe(false);
      }
    });

    it('handles non-Error exceptions in poll', async () => {
      mockGetJob.mockRejectedValue({ statusCode: 503 });

      const result = await adapter.pollJob('job-xyz');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPEECHMATICS_POLL_ERROR');
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });

  describe('getTranscript', () => {
    it('returns transcript text and summary when present', async () => {
      // json-v2 returns a flat array of word/punctuation results
      const mockJsonV2Response = {
        summary: { content: 'Summary of the audio' },
        results: [
          { alternatives: [{ content: 'Hello', confidence: 0.95 }] },
          { alternatives: [{ content: 'world', confidence: 0.92 }] },
        ],
      };
      mockGetJobResult.mockResolvedValue(mockJsonV2Response);

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('Hello world');
        expect(result.value.summary).toBe('Summary of the audio');
        expect(result.value.apiCall.operation).toBe('fetch_result');
        expect(result.value.apiCall.success).toBe(true);
        expect(result.value.apiCall.response).toEqual({
          jobId: 'job-123',
          transcriptLength: 11,
          hasSummary: true,
        });
      }

      expect(mockGetJobResult).toHaveBeenCalledWith('job-123', 'json-v2');
    });

    it('returns transcript without summary when summary missing', async () => {
      const mockJsonV2Response = {
        results: [
          { alternatives: [{ content: 'No', confidence: 0.9 }] },
          { alternatives: [{ content: 'summary', confidence: 0.88 }] },
        ],
      };
      mockGetJobResult.mockResolvedValue(mockJsonV2Response);

      const result = await adapter.getTranscript('job-456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('No summary');
        expect(result.value.summary).toBeUndefined();
      }
    });

    it('handles empty results array', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [],
      });

      const result = await adapter.getTranscript('job-empty');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('');
      }
    });

    it('handles missing alternatives in results', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [
          { alternatives: [{ content: 'Valid' }] },
          { alternatives: [] }, // No alternatives
          {}, // Missing alternatives key
        ],
      });

      const result = await adapter.getTranscript('job-malformed');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('Valid');
      }
    });

    it('returns error when transcript fetch fails', async () => {
      mockGetJobResult.mockRejectedValue(new Error('Job not found'));

      const result = await adapter.getTranscript('job-invalid');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPEECHMATICS_TRANSCRIPT_ERROR');
        expect(result.error.message).toBe('Job not found');
        expect(result.error.apiCall?.operation).toBe('fetch_result');
        expect(result.error.apiCall?.success).toBe(false);
      }
    });

    it('handles non-Error exceptions in getTranscript', async () => {
      mockGetJobResult.mockRejectedValue(null);

      const result = await adapter.getTranscript('job-xyz');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPEECHMATICS_TRANSCRIPT_ERROR');
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });

  describe('extractErrorMessage', () => {
    it('extracts error from object with error property', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'rejected',
          errors: [{ error: 'Connection refused' }],
        },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('rejected');
        expect(result.value.error?.code).toBe('JOB_REJECTED');
        expect(result.value.error?.message).toBe('Connection refused');
      }
    });

    it('extracts error from object with reason property', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'rejected',
          errors: [{ reason: 'Unauthorized access' }],
        },
      });

      const result = await adapter.pollJob('job-456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('rejected');
        expect(result.value.error?.code).toBe('JOB_REJECTED');
        expect(result.value.error?.message).toBe('Unauthorized access');
      }
    });

    it('prioritizes message over other properties', async () => {
      mockGetJob.mockResolvedValue({
        job: {
          status: 'rejected',
          errors: [{ message: 'Main error', error: 'Secondary error', reason: 'Tertiary reason' }],
        },
      });

      const result = await adapter.pollJob('job-789');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.error?.message).toBe('Main error');
      }
    });
  });
});
