/**
 * Speechmatics Batch API adapter.
 *
 * Implements SpeechTranscriptionPort using @speechmatics/batch-client.
 */
import { BatchClient } from '@speechmatics/batch-client';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '../../logger.js';
import type {
  SpeechTranscriptionPort,
  TranscriptionJobInput,
  TranscriptionJobPollResult,
  TranscriptionJobSubmitResult,
  TranscriptionPortError,
  TranscriptionTextResult,
  TranscriptionApiCall,
} from '../transcription-provider.js';
import { ADDITIONAL_VOCAB } from './vocabulary.js';

/**
 * Type definitions for Speechmatics json-v2 response.
 */
interface JsonV2Result {
  type?: string;
  alternatives?: { content?: string; language?: string }[];
}

interface JsonV2Summary {
  content: string;
}

interface JsonV2Metadata {
  language_pack_info?: {
    language_description?: string;
  };
}

interface JsonV2Response {
  summary?: JsonV2Summary;
  results: JsonV2Result[];
  metadata?: JsonV2Metadata;
}

/**
 * Speechmatics EU API base URL.
 */
const SPEECHMATICS_EU_API_URL = 'https://asr.api.speechmatics.com/v2';

/**
 * Extract a human-readable message from an error object.
 */
/* v8 ignore start -- ts-type: type narrowing for unknown error shapes @preserve */
function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj['message'] === 'string') {
      return obj['message'];
    }
    if (typeof obj['error'] === 'string') {
      return obj['error'];
    }
    if (typeof obj['reason'] === 'string') {
      return obj['reason'];
    }
  }
  return JSON.stringify(error);
}
/* v8 ignore stop @preserve */

/**
 * Extract detailed error context for debugging.
 */
/* v8 ignore start -- ts-type: type narrowing on unknown error shapes with optional properties @preserve */
function extractErrorContext(error: unknown): Record<string, unknown> {
  const context: Record<string, unknown> = {
    errorType: typeof error,
    errorName: error instanceof Error ? error.name : undefined,
    errorStack: error instanceof Error ? error.stack : undefined,
  };

  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;

    if (obj['status'] !== undefined) context['httpStatus'] = obj['status'];
    if (obj['statusCode'] !== undefined) context['httpStatusCode'] = obj['statusCode'];
    if (obj['statusText'] !== undefined) context['httpStatusText'] = obj['statusText'];

    if (obj['response'] !== undefined) {
      const resp = obj['response'] as Record<string, unknown>;
      context['responseStatus'] = resp['status'];
      context['responseStatusText'] = resp['statusText'];
      context['responseData'] = resp['data'];
    }

    if (obj['code'] !== undefined) context['errorCode'] = obj['code'];
    if (obj['reason'] !== undefined) context['reason'] = obj['reason'];
    if (obj['detail'] !== undefined) context['detail'] = obj['detail'];
    if (obj['errors'] !== undefined) context['errors'] = obj['errors'];

    if (obj['body'] !== undefined) context['body'] = obj['body'];

    if (obj['request'] !== undefined) {
      const req = obj['request'] as Record<string, unknown>;
      context['requestUrl'] = req['url'];
      context['requestMethod'] = req['method'];
    }

    if (obj['cause'] !== undefined) {
      context['cause'] = extractErrorMessage(obj['cause']);
    }

    context['availableKeys'] = Object.keys(obj);
  }

  return context;
}
/* v8 ignore stop @preserve */

/**
 * Create a TranscriptionApiCall record.
 */
function createApiCall(
  operation: TranscriptionApiCall['operation'],
  success: boolean,
  response?: unknown
): TranscriptionApiCall {
  return {
    timestamp: new Date().toISOString(),
    operation,
    success,
    response,
  };
}

/**
 * Speechmatics implementation of SpeechTranscriptionPort.
 */
export class SpeechmaticsTranscriptionAdapter implements SpeechTranscriptionPort {
  private readonly client: BatchClient;
  private readonly logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.client = new BatchClient({
      apiKey,
      apiUrl: SPEECHMATICS_EU_API_URL,
      appId: 'intexuraos-transcription',
    });
    this.logger = logger;
  }

  async submitJob(
    input: TranscriptionJobInput
  ): Promise<Result<TranscriptionJobSubmitResult, TranscriptionPortError>> {
    const startTime = Date.now();

    this.logger.info(
      {
        event: 'speechmatics_submit_start',
        audioUrl: input.audioUrl,
        mimeType: input.mimeType,
        language: input.language,
      },
      'Submitting transcription job to Speechmatics'
    );

    try {
      const response = await this.client.createTranscriptionJob(
        { url: input.audioUrl },
        {
          transcription_config: {
            language: input.language ?? 'auto',
            operating_point: 'enhanced',
            additional_vocab: ADDITIONAL_VOCAB,
            punctuation_overrides: {
              sensitivity: 0.35,
            },
            transcript_filtering_config: {
              remove_disfluencies: true,
            },
          },
          summarization_config: {
            summary_type: 'paragraphs',
            summary_length: 'brief',
            content_type: 'auto',
          },
        }
      );

      const durationMs = Date.now() - startTime;
      const apiCall = createApiCall('submit', true, { jobId: response.id });

      this.logger.info(
        { event: 'speechmatics_submit_success', jobId: response.id, durationMs },
        'Transcription job submitted successfully'
      );

      return ok({ jobId: response.id, apiCall });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      const errorContext = extractErrorContext(error);
      const apiCall = createApiCall('submit', false, { error: errorMessage, errorContext });

      this.logger.error(
        {
          event: 'speechmatics_submit_error',
          error: errorMessage,
          errorContext,
          durationMs,
          audioUrl: input.audioUrl,
        },
        'Failed to submit transcription job'
      );

      return err({ code: 'SPEECHMATICS_SUBMIT_ERROR', message: errorMessage, apiCall });
    }
  }

  async pollJob(
    jobId: string
  ): Promise<Result<TranscriptionJobPollResult, TranscriptionPortError>> {
    const startTime = Date.now();

    this.logger.info(
      { event: 'speechmatics_poll_start', jobId },
      'Polling transcription job status'
    );

    try {
      const response = await this.client.getJob(jobId);
      const durationMs = Date.now() - startTime;
      const jobStatus = response.job.status;

      let status: TranscriptionJobPollResult['status'];
      if (jobStatus === 'done') {
        status = 'done';
      } else if (jobStatus === 'rejected') {
        status = 'rejected';
      } else {
        status = 'running';
      }

      const apiCall = createApiCall('poll', true, {
        jobId,
        status: jobStatus,
        rawStatus: response.job.status,
      });

      this.logger.info(
        { event: 'speechmatics_poll_success', jobId, status, rawStatus: jobStatus, durationMs },
        'Poll successful'
      );

      const result: TranscriptionJobPollResult = { status, apiCall };

      if (status === 'rejected' && response.job.errors !== undefined) {
        const errorsValue: unknown = response.job.errors;
        let errorMessage: string;
        if (Array.isArray(errorsValue)) {
          errorMessage = errorsValue.map((e: unknown) => extractErrorMessage(e)).join('; ');
        } else {
          errorMessage = extractErrorMessage(errorsValue);
        }
        result.error = { code: 'JOB_REJECTED', message: errorMessage };
      }

      return ok(result);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      const errorContext = extractErrorContext(error);
      const apiCall = createApiCall('poll', false, { error: errorMessage, errorContext });

      this.logger.error(
        { event: 'speechmatics_poll_error', jobId, error: errorMessage, errorContext, durationMs },
        'Failed to poll job status'
      );

      return err({ code: 'SPEECHMATICS_POLL_ERROR', message: errorMessage, apiCall });
    }
  }

  async getTranscript(
    jobId: string
  ): Promise<Result<TranscriptionTextResult, TranscriptionPortError>> {
    const startTime = Date.now();

    this.logger.info(
      { event: 'speechmatics_transcript_start', jobId },
      'Fetching transcription result'
    );

    try {
      const result = (await this.client.getJobResult(
        jobId,
        'json-v2'
      )) as unknown as JsonV2Response;
      const durationMs = Date.now() - startTime;

      const summary = result.summary?.content;

      let detectedLanguage: string | undefined;
      if (Array.isArray(result.results) && result.results.length > 0) {
        const firstWord = result.results[0];
        detectedLanguage = firstWord?.alternatives?.[0]?.language;
      }
      /* v8 ignore start -- upstream: metadata language fallback depends on Speechmatics API response shape @preserve */
      if (
        detectedLanguage === undefined &&
        result.metadata?.language_pack_info?.language_description !== undefined
      ) {
        const langDesc = result.metadata.language_pack_info.language_description.toLowerCase();
        if (langDesc.includes('polish')) {
          detectedLanguage = 'pl';
        } else if (langDesc.includes('english')) {
          detectedLanguage = 'en';
        }
      }
      /* v8 ignore stop @preserve */

      let text = '';
      /* v8 ignore start -- upstream: non-array results guard for malformed Speechmatics API response @preserve */
      if (Array.isArray(result.results)) {
        for (const item of result.results) {
          const alt = item.alternatives?.[0];
          if (alt?.content !== undefined) {
            text += alt.content + ' ';
          }
        }
      }
      /* v8 ignore stop @preserve */
      text = text.trim();

      const apiCall = createApiCall('fetch_result', true, {
        jobId,
        transcriptLength: text.length,
        hasSummary: summary !== undefined,
        detectedLanguage,
      });

      this.logger.info(
        {
          event: 'speechmatics_transcript_success',
          jobId,
          transcriptLength: text.length,
          hasSummary: summary !== undefined,
          detectedLanguage,
          durationMs,
        },
        'Transcription fetched successfully'
      );

      return ok({
        text,
        ...(summary !== undefined && { summary }),
        ...(detectedLanguage !== undefined && { detectedLanguage }),
        apiCall,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      const errorContext = extractErrorContext(error);
      const apiCall = createApiCall('fetch_result', false, { error: errorMessage, errorContext });

      this.logger.error(
        {
          event: 'speechmatics_transcript_error',
          jobId,
          error: errorMessage,
          errorContext,
          durationMs,
        },
        'Failed to fetch transcription'
      );

      return err({ code: 'SPEECHMATICS_TRANSCRIPT_ERROR', message: errorMessage, apiCall });
    }
  }
}
