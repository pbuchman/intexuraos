/**
 * Tests for SpeechmaticsTranscriptionAdapter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@speechmatics/batch-client', () => ({
  BatchClient: class MockBatchClient {
    constructor(options: unknown) {
      constructorArgs.push(options);
    }
    createTranscriptionJob = mockCreateTranscriptionJob;
    getJob = mockGetJob;
    getJobResult = mockGetJobResult;
  },
}));

import { SpeechmaticsTranscriptionAdapter } from '../../providers/speechmatics/adapter.js';

const mockLogger = {
  level: 'info',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('SpeechmaticsTranscriptionAdapter', () => {
  let adapter: SpeechmaticsTranscriptionAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    constructorArgs.length = 0;
    adapter = new SpeechmaticsTranscriptionAdapter('test-api-key', mockLogger);
  });

  describe('constructor', () => {
    it('creates BatchClient with intexuraos-transcription appId', () => {
      expect(constructorArgs[0]).toEqual({
        apiKey: 'test-api-key',
        apiUrl: 'https://asr.api.speechmatics.com/v2',
        appId: 'intexuraos-transcription',
      });
    });
  });

  describe('submitJob', () => {
    it('returns job ID on success', async () => {
      mockCreateTranscriptionJob.mockResolvedValue({ id: 'job-123' });

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.jobId).toBe('job-123');
        expect(result.value.apiCall.operation).toBe('submit');
        expect(result.value.apiCall.success).toBe(true);
      }
    });

    it('uses language when provided', async () => {
      mockCreateTranscriptionJob.mockResolvedValue({ id: 'job-456' });

      await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
        language: 'pl',
      });

      const callArgs = mockCreateTranscriptionJob.mock.calls[0] as [
        unknown,
        { transcription_config: { language: string } },
      ];
      expect(callArgs[1].transcription_config.language).toBe('pl');
    });

    it('uses auto language when not provided', async () => {
      mockCreateTranscriptionJob.mockResolvedValue({ id: 'job-789' });

      await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      const callArgs = mockCreateTranscriptionJob.mock.calls[0] as [
        unknown,
        { transcription_config: { language: string } },
      ];
      expect(callArgs[1].transcription_config.language).toBe('auto');
    });

    it('returns error on Speechmatics API failure', async () => {
      mockCreateTranscriptionJob.mockRejectedValue(new Error('API key invalid'));

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPEECHMATICS_SUBMIT_ERROR');
        expect(result.error.message).toBe('API key invalid');
        expect(result.error.apiCall?.success).toBe(false);
      }
    });

    it('includes additional vocab in request', async () => {
      mockCreateTranscriptionJob.mockResolvedValue({ id: 'job-vocab' });

      await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      const callArgs = mockCreateTranscriptionJob.mock.calls[0] as [
        unknown,
        { transcription_config: { additional_vocab: unknown[] } },
      ];
      expect(callArgs[1].transcription_config.additional_vocab).toBeInstanceOf(Array);
      expect(callArgs[1].transcription_config.additional_vocab.length).toBeGreaterThan(0);
    });
  });

  describe('pollJob', () => {
    it('returns done status when job is done', async () => {
      mockGetJob.mockResolvedValue({ job: { status: 'done' } });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('done');
        expect(result.value.apiCall.operation).toBe('poll');
        expect(result.value.apiCall.success).toBe(true);
      }
    });

    it('returns running status when job is in progress', async () => {
      mockGetJob.mockResolvedValue({ job: { status: 'running' } });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('running');
      }
    });

    it('returns rejected status when job fails', async () => {
      mockGetJob.mockResolvedValue({
        job: { status: 'rejected', errors: [{ message: 'Audio too short' }] },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('rejected');
        expect(result.value.error?.code).toBe('JOB_REJECTED');
        expect(result.value.error?.message).toContain('Audio too short');
      }
    });

    it('handles rejected job with non-array errors', async () => {
      mockGetJob.mockResolvedValue({
        job: { status: 'rejected', errors: { message: 'Non-array error' } },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('rejected');
        expect(result.value.error?.message).toContain('Non-array error');
      }
    });

    it('returns error when poll API fails', async () => {
      mockGetJob.mockRejectedValue(new Error('Connection timeout'));

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPEECHMATICS_POLL_ERROR');
        expect(result.error.message).toBe('Connection timeout');
      }
    });

    it('maps unknown status to running', async () => {
      mockGetJob.mockResolvedValue({ job: { status: 'processing' } });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('running');
      }
    });
  });

  describe('getTranscript', () => {
    it('returns transcribed text with language from first result', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [
          { alternatives: [{ content: 'Hello', language: 'en' }] },
          { alternatives: [{ content: 'world' }] },
        ],
      });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('Hello world');
        expect(result.value.detectedLanguage).toBe('en');
        expect(result.value.apiCall.operation).toBe('fetch_result');
        expect(result.value.apiCall.success).toBe(true);
      }
    });

    it('returns transcript with summary when available', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [{ alternatives: [{ content: 'Hello' }] }],
        summary: { content: 'Summary text' },
      });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('Hello');
        expect(result.value.summary).toBe('Summary text');
      }
    });

    it('returns error when fetch API fails', async () => {
      mockGetJobResult.mockRejectedValue(new Error('Job not found'));

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SPEECHMATICS_TRANSCRIPT_ERROR');
        expect(result.error.message).toBe('Job not found');
      }
    });

    it('handles empty results array', async () => {
      mockGetJobResult.mockResolvedValue({ results: [] });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('');
        expect(result.value.detectedLanguage).toBeUndefined();
        expect(result.value.summary).toBeUndefined();
      }
    });

    it('handles result without alternatives', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [{ type: 'punctuation' }],
      });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('');
      }
    });

    it('falls back to metadata language_pack_info for Polish', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [{ alternatives: [{ content: 'Cześć' }] }],
        metadata: {
          language_pack_info: {
            language_description: 'Polish',
          },
        },
      });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.detectedLanguage).toBe('pl');
      }
    });

    it('falls back to metadata language_pack_info for English', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [{ alternatives: [{ content: 'Hello' }] }],
        metadata: {
          language_pack_info: {
            language_description: 'English',
          },
        },
      });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.detectedLanguage).toBe('en');
      }
    });

    it('does not set detectedLanguage when metadata has unrecognized language', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [{ alternatives: [{ content: 'Bonjour' }] }],
        metadata: {
          language_pack_info: {
            language_description: 'French',
          },
        },
      });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.detectedLanguage).toBeUndefined();
      }
    });

    it('prefers language from first result alternative over metadata fallback', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [{ alternatives: [{ content: 'Hello', language: 'en' }] }],
        metadata: {
          language_pack_info: {
            language_description: 'Polish',
          },
        },
      });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.detectedLanguage).toBe('en');
      }
    });

    it('falls back to metadata language when results array is empty', async () => {
      mockGetJobResult.mockResolvedValue({
        results: [],
        metadata: {
          language_pack_info: {
            language_description: 'Polish',
          },
        },
      });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.detectedLanguage).toBe('pl');
        expect(result.value.text).toBe('');
      }
    });

    it('handles non-array results gracefully', async () => {
      mockGetJobResult.mockResolvedValue({
        results: 'not-an-array',
      });

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.text).toBe('');
        expect(result.value.detectedLanguage).toBeUndefined();
      }
    });
  });

  describe('extractErrorMessage (via pollJob rejected errors)', () => {
    it('extracts message from string error in rejected job', async () => {
      mockGetJob.mockResolvedValue({
        job: { status: 'rejected', errors: 'string error message' },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.error?.message).toBe('string error message');
      }
    });

    it('extracts message from object with error property in rejected job', async () => {
      mockGetJob.mockResolvedValue({
        job: { status: 'rejected', errors: { error: 'error-prop value' } },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.error?.message).toBe('error-prop value');
      }
    });

    it('extracts message from object with reason property in rejected job', async () => {
      mockGetJob.mockResolvedValue({
        job: { status: 'rejected', errors: { reason: 'reason-prop value' } },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.error?.message).toBe('reason-prop value');
      }
    });

    it('falls back to JSON.stringify for unrecognized error shape', async () => {
      mockGetJob.mockResolvedValue({
        job: { status: 'rejected', errors: { unknown: 42 } },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.error?.message).toBe('{"unknown":42}');
      }
    });

    it('falls back to JSON.stringify for numeric error', async () => {
      mockGetJob.mockResolvedValue({
        job: { status: 'rejected', errors: 42 },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.error?.message).toBe('42');
      }
    });

    it('falls back to JSON.stringify for null error', async () => {
      mockGetJob.mockResolvedValue({
        job: { status: 'rejected', errors: null },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.error?.message).toBe('null');
      }
    });

    it('joins array of string errors with extractErrorMessage', async () => {
      mockGetJob.mockResolvedValue({
        job: { status: 'rejected', errors: ['first error', 'second error'] },
      });

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.error?.message).toBe('first error; second error');
      }
    });
  });

  describe('extractErrorContext (via error catch blocks)', () => {
    it('captures error with status and statusCode', async () => {
      const richError = Object.assign(new Error('HTTP error'), {
        status: 401,
        statusCode: 401,
        statusText: 'Unauthorized',
      });
      mockCreateTranscriptionJob.mockRejectedValue(richError);

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const response = result.error.apiCall?.response as Record<string, unknown>;
        const errorContext = response['errorContext'] as Record<string, unknown>;
        expect(errorContext['httpStatus']).toBe(401);
        expect(errorContext['httpStatusCode']).toBe(401);
        expect(errorContext['httpStatusText']).toBe('Unauthorized');
      }
    });

    it('captures error with nested response object', async () => {
      const richError = Object.assign(new Error('API error'), {
        response: { status: 500, statusText: 'Internal Server Error', data: { detail: 'oops' } },
      });
      mockGetJob.mockRejectedValue(richError);

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const response = result.error.apiCall?.response as Record<string, unknown>;
        const errorContext = response['errorContext'] as Record<string, unknown>;
        expect(errorContext['responseStatus']).toBe(500);
        expect(errorContext['responseStatusText']).toBe('Internal Server Error');
        expect(errorContext['responseData']).toEqual({ detail: 'oops' });
      }
    });

    it('captures error with code, reason, detail, errors, and body', async () => {
      const richError = Object.assign(new Error('Complex error'), {
        code: 'ECONNREFUSED',
        reason: 'connection refused',
        detail: 'could not connect to host',
        errors: [{ field: 'url', message: 'invalid' }],
        body: { raw: 'data' },
      });
      mockGetJobResult.mockRejectedValue(richError);

      const result = await adapter.getTranscript('job-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const response = result.error.apiCall?.response as Record<string, unknown>;
        const errorContext = response['errorContext'] as Record<string, unknown>;
        expect(errorContext['errorCode']).toBe('ECONNREFUSED');
        expect(errorContext['reason']).toBe('connection refused');
        expect(errorContext['detail']).toBe('could not connect to host');
        expect(errorContext['errors']).toEqual([{ field: 'url', message: 'invalid' }]);
        expect(errorContext['body']).toEqual({ raw: 'data' });
      }
    });

    it('captures error with nested request object', async () => {
      const richError = Object.assign(new Error('Request error'), {
        request: { url: 'https://api.example.com/v2/jobs', method: 'POST' },
      });
      mockCreateTranscriptionJob.mockRejectedValue(richError);

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const response = result.error.apiCall?.response as Record<string, unknown>;
        const errorContext = response['errorContext'] as Record<string, unknown>;
        expect(errorContext['requestUrl']).toBe('https://api.example.com/v2/jobs');
        expect(errorContext['requestMethod']).toBe('POST');
      }
    });

    it('captures error with cause property', async () => {
      const richError = Object.assign(new Error('Wrapper'), {
        cause: new Error('Root cause'),
      });
      mockCreateTranscriptionJob.mockRejectedValue(richError);

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const response = result.error.apiCall?.response as Record<string, unknown>;
        const errorContext = response['errorContext'] as Record<string, unknown>;
        expect(errorContext['cause']).toBe('Root cause');
      }
    });

    it('captures error name and stack for Error instances', async () => {
      mockGetJob.mockRejectedValue(new TypeError('type mismatch'));

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const response = result.error.apiCall?.response as Record<string, unknown>;
        const errorContext = response['errorContext'] as Record<string, unknown>;
        expect(errorContext['errorType']).toBe('object');
        expect(errorContext['errorName']).toBe('TypeError');
        expect(typeof errorContext['errorStack']).toBe('string');
      }
    });

    it('handles non-Error thrown values', async () => {
      mockGetJob.mockRejectedValue('plain string error');

      const result = await adapter.pollJob('job-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const response = result.error.apiCall?.response as Record<string, unknown>;
        const errorContext = response['errorContext'] as Record<string, unknown>;
        expect(errorContext['errorType']).toBe('string');
        expect(errorContext['errorName']).toBeUndefined();
        expect(errorContext['errorStack']).toBeUndefined();
      }
    });

    it('includes availableKeys for object errors', async () => {
      const richError = Object.assign(new Error('test'), { customField: 'value' });
      mockCreateTranscriptionJob.mockRejectedValue(richError);

      const result = await adapter.submitJob({
        audioUrl: 'https://storage.example.com/audio.ogg',
        mimeType: 'audio/ogg',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const response = result.error.apiCall?.response as Record<string, unknown>;
        const errorContext = response['errorContext'] as Record<string, unknown>;
        const keys = errorContext['availableKeys'] as string[];
        expect(keys).toContain('customField');
      }
    });
  });
});
