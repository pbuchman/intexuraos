import { createHmac } from 'node:crypto';
import type { Logger } from 'pino';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import { buildTaskCallbackUrl } from './callback-url.js';

/**
 * Orchestrator-side HTTP client that commits a terminal task status to code-agent
 * via `PATCH /internal/code-tasks/status`.
 *
 * Signing scheme is `HMAC-SHA256(secret, timestamp + "." + rawBody)`, with
 * `X-Request-Timestamp`, `X-Request-Signature`, and `X-Internal-Auth` headers.
 * When a task webhook secret is available, use it so callbacks can cross
 * dev/prod ownership boundaries. Otherwise fall back to the shared
 * orchestrator secret for legacy internal callers.
 *
 * Design reference: INT-1413 finalize-task robustness plan (Task 3).
 */

export interface StatusUpdateClientConfig {
  codeAgentUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
  logger: Logger;
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  /** Optional fetch override; primarily for tests (e.g. injecting non-Error throws). */
  fetchFn?: typeof fetch;
}

export interface StatusUpdatePayload {
  taskId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
  completedAt: Date;
  webhookUrl?: string;
  webhookSecret?: string;
  error?: { code: string; message: string };
  result?: { prUrl?: string; branch?: string; summary?: string };
}

export type StatusUpdateError =
  | { type: 'network'; message: string }
  | { type: '4xx'; status: number; message: string }
  | { type: '5xx'; status: number; message: string }
  | { type: 'timeout'; message: string };

export type StatusUpdateResult = { ok: true } | { ok: false; error: StatusUpdateError };

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 9000];
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class StatusUpdateClient {
  private readonly codeAgentUrl: string;
  private readonly orchestratorSecret: string;
  private readonly internalAuthToken: string;
  private readonly logger: Logger;
  private readonly retryDelaysMs: readonly number[];
  private readonly requestTimeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: StatusUpdateClientConfig) {
    this.codeAgentUrl = config.codeAgentUrl.replace(/\/+$/, '');
    this.orchestratorSecret = config.orchestratorSecret;
    this.internalAuthToken = config.internalAuthToken;
    this.logger = config.logger;
    this.retryDelaysMs = config.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async commit(payload: StatusUpdatePayload): Promise<StatusUpdateResult> {
    const body: Record<string, unknown> = {
      taskId: payload.taskId,
      status: payload.status,
      completedAt: payload.completedAt.toISOString(),
    };
    if (payload.error !== undefined) {
      body['error'] = payload.error;
    }
    if (payload.result !== undefined) {
      body['result'] = payload.result;
    }
    const rawBody = JSON.stringify(body);

    let lastError: StatusUpdateError = {
      type: 'network',
      message: 'no attempts were made',
    };
    const maxAttempts = this.retryDelaysMs.length + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const outcome = await this.deliver(rawBody, payload.webhookUrl, payload.webhookSecret);

      if (outcome.ok) {
        if (attempt > 0) {
          this.logger.info(
            { taskId: payload.taskId, attempts: attempt + 1 },
            'Status update committed after retries'
          );
        }
        return { ok: true };
      }

      lastError = outcome.error;

      this.logger.warn(
        {
          taskId: payload.taskId,
          attempt: attempt + 1,
          errorType: outcome.error.type,
          errorMessage: outcome.error.message,
          [SKIP_SENTRY_KEY]: true,
        },
        'Status update attempt failed'
      );

      // 4xx responses are non-retryable — surface immediately so the caller
      // can decide whether to escalate (e.g. log and mark task finalized anyway).
      if (outcome.error.type === '4xx') {
        return { ok: false, error: outcome.error };
      }

      // On the final attempt there is no matching delay entry (retryDelaysMs has
      // length maxAttempts - 1). noUncheckedIndexedAccess makes that `undefined`
      // explicit, so we simply skip waiting — no fallback constant needed.
      const nextDelay = this.retryDelaysMs[attempt];
      if (nextDelay !== undefined) {
        await new Promise<void>((resolve) => setTimeout(resolve, nextDelay));
      }
    }

    this.logger.error(
      {
        taskId: payload.taskId,
        attempts: maxAttempts,
        errorType: lastError.type,
        errorMessage: lastError.message,
      },
      'Status update failed after exhausting retries'
    );
    return { ok: false, error: lastError };
  }

  private async deliver(
    rawBody: string,
    webhookUrl: string | undefined, // @allow-undefined-type -- function parameter, not optional property
    webhookSecret: string | undefined // @allow-undefined-type -- function parameter, not optional property
  ): Promise<{ ok: true } | { ok: false; error: StatusUpdateError }> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signatureSecret = webhookSecret ?? this.orchestratorSecret;
    const signature = createHmac('sha256', signatureSecret)
      .update(`${String(timestamp)}.${rawBody}`)
      .digest('hex');

    const url = buildTaskCallbackUrl(webhookUrl, this.codeAgentUrl, '/internal/code-tasks/status');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.requestTimeoutMs);

    try {
      const response = await this.fetchFn(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': String(timestamp),
          'X-Request-Signature': signature,
          'X-Internal-Auth': this.internalAuthToken,
        },
        body: rawBody,
        signal: controller.signal,
      });

      if (response.ok) {
        return { ok: true };
      }

      const text = await response.text().catch(() => '');
      const message = text !== '' ? text : `HTTP ${String(response.status)}`;
      if (response.status >= 400 && response.status < 500) {
        return {
          ok: false,
          error: { type: '4xx', status: response.status, message },
        };
      }
      return {
        ok: false,
        error: { type: '5xx', status: response.status, message },
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          ok: false,
          error: {
            type: 'timeout',
            message: `Request timed out after ${String(this.requestTimeoutMs)}ms`,
          },
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { type: 'network', message } };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
