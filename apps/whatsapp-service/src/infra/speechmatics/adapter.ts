/**
 * Speechmatics Batch API adapter.
 *
 * Implements SpeechTranscriptionPort using @speechmatics/batch-client.
 *
 * ## Cloud Run Considerations
 *
 * This adapter is designed for in-process async transcription in Cloud Run.
 * Risks documented in docs/architecture/transcription.md:
 * - Container may be killed before transcription completes
 * - Long audio files (>5 min) at higher risk
 * - Consider min_scale=1 for reliability
 */
import { BatchClient } from '@speechmatics/batch-client';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import pino from 'pino';
import type {
  SpeechTranscriptionPort,
  TranscriptionApiCall,
  TranscriptionJobInput,
  TranscriptionJobPollResult,
  TranscriptionJobSubmitResult,
  TranscriptionPortError,
  TranscriptionTextResult,
} from '../../domain/whatsapp/index.js';

const logger = pino({ name: 'speechmatics-adapter' });

/**
 * Type definitions for Speechmatics json-v2 response.
 * These are minimal types needed to extract transcript and summary.
 *
 * json-v2 returns a flat array of recognition results (words, punctuation,
 * speaker changes). Each result has alternatives with the actual content.
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
 * Custom vocabulary for Speechmatics transcription.
 *
 * Includes IntexuraOS brand terms, development tools, agent names,
 * cloud platforms, and Polish-English code-mixed terms that are
 * commonly used but may be misrecognized.
 *
 * Each entry provides the canonical spelling and alternative pronunciations
 * via `sounds_like` to improve recognition accuracy.
 *
 * Updated based on analysis of Linear issue descriptions to include
 * domain-specific terminology from project workflows.
 */
const ADDITIONAL_VOCAB = [
  // Brand terms
  { content: 'IntexuraOS', sounds_like: ['in tex ura o s', 'in tech sura o s', 'inteksura os', 'in texture os'] },
  { content: 'pbuchman', sounds_like: ['p buck man', 'p book man', 'piotr buchman'] },

  // Development tools
  { content: 'pnpm', sounds_like: ['p n p m', 'pin pm', 'pee en pee em', 'performant npm'] },
  { content: 'tf', sounds_like: ['tea eff', 'terraform'] },
  { content: 'gh', sounds_like: ['gee aitch', 'git hub'] },
  { content: 'ci:tracked', sounds_like: ['see eye tracked', 'c i tracked'] },
  { content: 'monorepo', sounds_like: ['mono repo', 'mono reap oh'] },
  { content: 'worktree', sounds_like: ['work tree'] },

  // Service agents
  { content: 'service-scribe', sounds_like: ['service scribe'] },
  { content: 'coverage-orchestrator', sounds_like: ['coverage orchestrator'] },
  { content: 'promptvault', sounds_like: ['prompt vault'] },
  { content: 'promptvault-service', sounds_like: ['prompt vault service'] },
  { content: 'actions-agent', sounds_like: ['actions agent'] },
  { content: 'research-agent', sounds_like: ['research agent'] },
  { content: 'commands-agent', sounds_like: ['commands agent'] },
  { content: 'data-insights-agent', sounds_like: ['data insights agent'] },
  { content: 'bookmarks-agent', sounds_like: ['bookmarks agent'] },
  { content: 'todos-agent', sounds_like: ['to dos agent', 'todos agent'] },
  { content: 'web-agent', sounds_like: ['web agent'] },
  { content: 'calendar-agent', sounds_like: ['calendar agent'] },
  { content: 'linear-agent', sounds_like: ['linear agent'] },
  { content: 'notes-agent', sounds_like: ['notes agent'] },
  { content: 'user-service', sounds_like: ['user service'] },
  { content: 'whatsapp-service', sounds_like: ['whatsapp service', 'what sap service'] },
  { content: 'notion-service', sounds_like: ['notion service'] },
  { content: 'image-service', sounds_like: ['image service'] },

  // AI/LLM providers and models
  { content: 'z.ai', sounds_like: ['zed dot a i', 'zee dot a i', 'zai', 'the ai'] },
  { content: 'GLM-4.7', sounds_like: ['gee el em four point seven'] },
  { content: 'Claude Opus', sounds_like: ['cloud opus', 'claude opus'] },
  { content: 'Claude Sonnet', sounds_like: ['cloud sonnet', 'claude sonnet'] },
  { content: 'Gemini', sounds_like: ['gem in eye', 'gem ini'] },
  { content: 'OpenAI', sounds_like: ['open a i', 'open ai'] },
  { content: 'Anthropic', sounds_like: ['an throw pick', 'an throp ik'] },
  { content: 'Perplexity', sounds_like: ['per plex ity'] },
  { content: 'Perplexity Sonar', sounds_like: ['perplexity sonar'] },
  { content: 'LMS', sounds_like: ['el em ess', 'learning management system'] },
  {
    content: 'LLM',
    sounds_like: [
      'el el em',
      'elle em',
      'large language model',
      'ell ell em',
      'double l m',
      'ell l m',
    ],
  },
  {
    content: 'LLMs',
    sounds_like: [
      'el el ems',
      'elle ems',
      'large language models',
      'ell ell ems',
      'double l ms',
      'ell l ms',
    ],
  },
  {
    content: 'large language model',
    sounds_like: ['large lang model', 'large language model', 'large lang models'],
  },
  {
    content: 'large language models',
    sounds_like: ['large lang models', 'large language models', 'large lang model'],
  },

  // Platform tools and services
  { content: 'Linear', sounds_like: ['line ear', 'linear app', 'lin ear', 'linear', 'leener'] },
  { content: 'Sentry', sounds_like: ['sentry', 'century'] },
  { content: 'Auth0', sounds_like: ['auth zero', 'oauth'] },
  { content: 'OAuth', sounds_like: ['oh auth', 'o auth'] },
  { content: 'Notion', sounds_like: ['no shun', 'notion'] },
  { content: 'WhatsApp', sounds_like: ['whats app', 'what sap'] },
  { content: 'Firestore', sounds_like: ['fire store'] },
  { content: 'Pub/Sub', sounds_like: ['pub sub', 'publish subscribe'] },
  { content: 'pubsub', sounds_like: ['pub sub'] },
  { content: 'Vite', sounds_like: ['veet', 'vight'] },
  { content: 'Vitest', sounds_like: ['veet test', 'vight test'] },
  { content: 'Fastify', sounds_like: ['fast if i'] },
  { content: 'Bun', sounds_like: ['bun', 'bunn'] },
  { content: 'Bunx', sounds_like: ['bun x', 'bunks'] },
  { content: 'Speechmatics', sounds_like: ['speech matics'] },
  { content: 'Zod', sounds_like: ['zod', 'zodd'] },

  // Cloud/DevOps
  { content: 'GCP', sounds_like: ['gee see pee', 'g c p'] },
  { content: 'GCS', sounds_like: ['gee see ess', 'g c s'] },
  { content: 'WABA', sounds_like: ['wah bah', 'w a b a'] },
  { content: 'SemVer', sounds_like: ['sem ver', 'semantic versioning'] },
  { content: 'JWKS', sounds_like: ['jay double you kay ess', 'j w k s'] },
  { content: 'Cloud Run', sounds_like: ['cloud run'] },
  { content: 'Cloud Build', sounds_like: ['cloud build'] },
  { content: 'cloudbuild', sounds_like: ['cloud build'] },
  { content: 'Workload Identity', sounds_like: ['workload identity'] },
  { content: 'Kanban', sounds_like: ['can ban', 'kahn bahn'] },
  { content: 'TDD', sounds_like: ['tee dee dee'] },
  { content: 'api-docs-hub', sounds_like: ['api docs hub'] },
  { content: 'smart-dispatch', sounds_like: ['smart dispatch'] },
  { content: 'Terraform', sounds_like: ['terra form'] },
  { content: 'emulator', sounds_like: ['em you lay tor'] },
  { content: 'webhook', sounds_like: ['web hook'] },
  { content: 'PWA', sounds_like: ['pee double you ay', 'p w a'] },

  // Architecture terms
  { content: 'usecase', sounds_like: ['use case'] },
  { content: 'infra', sounds_like: ['in fra', 'infrastructure'] },
  { content: 'dto', sounds_like: ['dee tee oh', 'd t o'] },
  { content: 'compositeIndex', sounds_like: ['composite index'] },
  { content: 'barrel export', sounds_like: ['barrel export'] },

  // Common dev terms
  { content: 'scaffolded', sounds_like: ['scaffold it', 'ska folded'] },
  { content: 'delikatny', sounds_like: ['deli cat ny'] },
  { content: 'enhance', sounds_like: ['en hance'] },
  { content: 'enhancement', sounds_like: ['en hance ment'] },

  // Polish terms commonly used in mixed context
  { content: 'wygaszać', sounds_like: ['vi ga shatch', 've ga shatch'] },
  { content: 'zaakceptujemy', sounds_like: ['za ak cep tu ye my', 'zah ak cep tu jemy'] },
  { content: 'kliknięcia', sounds_like: ['click nien cia', 'klik nien cia'] },
  { content: 'kontenerze', sounds_like: ['con ten er zhe', 'kontenerze'] },
  { content: 'sprawdzenie', sounds_like: ['sprav dze nie'] },
  { content: 'zapasów', sounds_like: ['za pa soof', 'zapasuv'] },
  { content: 'grupować', sounds_like: ['group o vatch'] },

  // Polish-English code-mixed verbs (Polish suffix on English root)
  { content: 'commitować', sounds_like: ['commit o vatch'] },
  { content: 'merge\'ować', sounds_like: ['merge o vatch'] },
  { content: 'pushować', sounds_like: ['push o vatch'] },
];

/**
 * Extract a human-readable message from an error object.
 * Handles various error formats from Speechmatics API.
 */
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

/**
 * Extract detailed error context for debugging.
 * Captures HTTP status, response body, and nested error properties.
 */
function extractErrorContext(error: unknown): Record<string, unknown> {
  const context: Record<string, unknown> = {
    errorType: typeof error,
    errorName: error instanceof Error ? error.name : undefined,
    errorStack: error instanceof Error ? error.stack : undefined,
  };

  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;

    // HTTP-related properties (axios, fetch, etc.)
    if (obj['status'] !== undefined) context['httpStatus'] = obj['status'];
    if (obj['statusCode'] !== undefined) context['httpStatusCode'] = obj['statusCode'];
    if (obj['statusText'] !== undefined) context['httpStatusText'] = obj['statusText'];

    // Response body properties
    if (obj['response'] !== undefined) {
      const resp = obj['response'] as Record<string, unknown>;
      context['responseStatus'] = resp['status'];
      context['responseStatusText'] = resp['statusText'];
      context['responseData'] = resp['data'];
    }

    // Speechmatics-specific error properties
    if (obj['code'] !== undefined) context['errorCode'] = obj['code'];
    if (obj['reason'] !== undefined) context['reason'] = obj['reason'];
    if (obj['detail'] !== undefined) context['detail'] = obj['detail'];
    if (obj['errors'] !== undefined) context['errors'] = obj['errors'];

    // Body content (some HTTP clients put response here)
    if (obj['body'] !== undefined) context['body'] = obj['body'];

    // Request info for context
    if (obj['request'] !== undefined) {
      const req = obj['request'] as Record<string, unknown>;
      context['requestUrl'] = req['url'];
      context['requestMethod'] = req['method'];
    }

    // Cause chain (modern Error.cause)
    if (obj['cause'] !== undefined) {
      context['cause'] = extractErrorMessage(obj['cause']);
    }

    // Raw object keys to see what we might be missing
    context['availableKeys'] = Object.keys(obj);
  }

  return context;
}

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

  constructor(apiKey: string) {
    this.client = new BatchClient({
      apiKey,
      apiUrl: SPEECHMATICS_EU_API_URL,
      appId: 'intexuraos-whatsapp-service',
    });
  }

  /**
   * Submit an audio file for transcription.
   */
  async submitJob(
    input: TranscriptionJobInput
  ): Promise<Result<TranscriptionJobSubmitResult, TranscriptionPortError>> {
    const startTime = Date.now();

    logger.info(
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

      logger.info(
        {
          event: 'speechmatics_submit_success',
          jobId: response.id,
          durationMs,
        },
        'Transcription job submitted successfully'
      );

      return ok({
        jobId: response.id,
        apiCall,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      // Extract detailed error context for debugging
      const errorContext = extractErrorContext(error);
      const apiCall = createApiCall('submit', false, {
        error: errorMessage,
        errorContext,
      });

      logger.error(
        {
          event: 'speechmatics_submit_error',
          error: errorMessage,
          errorContext,
          durationMs,
          audioUrl: input.audioUrl,
          mimeType: input.mimeType,
          language: input.language ?? 'auto',
        },
        'Failed to submit transcription job'
      );

      return err({
        code: 'SPEECHMATICS_SUBMIT_ERROR',
        message: errorMessage,
        apiCall,
      });
    }
  }

  /**
   * Poll the status of a transcription job.
   */
  async pollJob(
    jobId: string
  ): Promise<Result<TranscriptionJobPollResult, TranscriptionPortError>> {
    const startTime = Date.now();

    logger.info(
      {
        event: 'speechmatics_poll_start',
        jobId,
      },
      'Polling transcription job status'
    );

    try {
      const response = await this.client.getJob(jobId);
      const durationMs = Date.now() - startTime;
      const jobStatus = response.job.status;

      // Map Speechmatics status to our status
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

      logger.info(
        {
          event: 'speechmatics_poll_success',
          jobId,
          status,
          rawStatus: jobStatus,
          durationMs,
        },
        'Poll successful'
      );

      const result: TranscriptionJobPollResult = {
        status,
        apiCall,
      };

      // Add error details if rejected
      if (status === 'rejected' && response.job.errors !== undefined) {
        const errorsValue: unknown = response.job.errors;
        let errorMessage: string;
        if (Array.isArray(errorsValue)) {
          errorMessage = errorsValue.map((e: unknown) => extractErrorMessage(e)).join('; ');
        } else {
          errorMessage = extractErrorMessage(errorsValue);
        }
        result.error = {
          code: 'JOB_REJECTED',
          message: errorMessage,
        };
      }

      return ok(result);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      const errorContext = extractErrorContext(error);
      const apiCall = createApiCall('poll', false, { error: errorMessage, errorContext });

      logger.error(
        {
          event: 'speechmatics_poll_error',
          jobId,
          error: errorMessage,
          errorContext,
          durationMs,
        },
        'Failed to poll job status'
      );

      return err({
        code: 'SPEECHMATICS_POLL_ERROR',
        message: errorMessage,
        apiCall,
      });
    }
  }

  /**
   * Fetch the transcription result for a completed job.
   *
   * Uses json-v2 format to retrieve both the full transcript and
   * AI-generated summary (if available).
   */
  async getTranscript(
    jobId: string
  ): Promise<Result<TranscriptionTextResult, TranscriptionPortError>> {
    const startTime = Date.now();

    logger.info(
      {
        event: 'speechmatics_transcript_start',
        jobId,
      },
      'Fetching transcription result'
    );

    try {
      const result = (await this.client.getJobResult(jobId, 'json-v2')) as unknown as JsonV2Response;
      const durationMs = Date.now() - startTime;

      // Extract summary from json-v2 response (optional field)
      const summary = result.summary?.content;

      // Extract detected language from first word's alternatives or metadata
      let detectedLanguage: string | undefined;
      if (Array.isArray(result.results) && result.results.length > 0) {
        const firstWord = result.results[0];
        detectedLanguage = firstWord?.alternatives?.[0]?.language;
      }
      // Fallback to metadata language pack info if available
      if (detectedLanguage === undefined && result.metadata?.language_pack_info?.language_description !== undefined) {
        // Convert description like "Polish" to code like "pl"
        const langDesc = result.metadata.language_pack_info.language_description.toLowerCase();
        if (langDesc.includes('polish')) {
          detectedLanguage = 'pl';
        } else if (langDesc.includes('english')) {
          detectedLanguage = 'en';
        }
      }

      // Reconstruct full text from results array
      // json-v2 returns flat array of words/punctuation with alternatives
      let text = '';
      if (Array.isArray(result.results)) {
        for (const item of result.results) {
          const alt = item.alternatives?.[0];
          if (alt?.content !== undefined) {
            text += alt.content + ' ';
          }
        }
      }
      text = text.trim();

      const apiCall = createApiCall('fetch_result', true, {
        jobId,
        transcriptLength: text.length,
        hasSummary: summary !== undefined,
        detectedLanguage,
      });

      logger.info(
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

      logger.error(
        {
          event: 'speechmatics_transcript_error',
          jobId,
          error: errorMessage,
          errorContext,
          durationMs,
        },
        'Failed to fetch transcription'
      );

      return err({
        code: 'SPEECHMATICS_TRANSCRIPT_ERROR',
        message: errorMessage,
        apiCall,
      });
    }
  }
}
