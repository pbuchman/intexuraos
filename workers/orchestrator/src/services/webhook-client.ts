import { createHmac } from 'node:crypto';
import { getErrorCauseChain, type Result, type Logger } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import { Mutex } from 'async-mutex';
import type { StatePersistence } from './state-persistence.js';
import type { PendingWebhook } from '../types/state.js';
import { normalizeInternalCallbackUrl } from './callback-url.js';

export interface WebhookPayload {
  taskId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
  result?: unknown;
  error?: unknown;
  duration: number;
}

export interface WebhookError {
  type: 'network' | '4xx' | '5xx' | 'timeout';
  message: string;
  originalError?: unknown;
}

const RETRY_DELAYS = [5000, 15000, 45000]; // 5s, 15s, 45s
const MAX_RETRIES = 3;
const PENDING_WEBHOOK_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms

function signPayload(payload: string, secret: string, timestamp: number): string {
  const message = `${String(timestamp)}.${payload}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

function pendingWebhookIdentity(webhook: PendingWebhook): string {
  return JSON.stringify([
    webhook.url,
    webhook.secret,
    webhook.payload,
    webhook.taskId,
    webhook.attempts,
    webhook.createdAt,
  ]);
}

export class WebhookClient {
  private inFlightCallbacks = 0;

  private terminalCallbackActivityTotal = 0;

  private readonly retryMutex = new Mutex();

  constructor(
    private readonly statePersistence: StatePersistence,
    private readonly logger: Logger,
    private readonly internalAuthToken: string
  ) {}

  private beginTerminalCallback(): void {
    this.inFlightCallbacks += 1;
    this.terminalCallbackActivityTotal += 1;
  }

  private endTerminalCallback(): void {
    this.inFlightCallbacks -= 1;
    this.terminalCallbackActivityTotal += 1;
  }

  async send(params: {
    url: string;
    secret: string;
    payload: unknown;
    taskId: string;
  }): Promise<Result<void, WebhookError>> {
    this.beginTerminalCallback();
    try {
      const { url, secret, payload, taskId } = params;
      const normalizedUrl = normalizeInternalCallbackUrl(url);

      // Serialize payload to JSON
      const rawJsonBody = JSON.stringify(payload);

      // Generate signature
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signPayload(rawJsonBody, secret, timestamp);

      this.logger.info({ taskId, url: normalizedUrl, payload }, 'Sending webhook');

      // Attempt delivery with retries
      let lastError: WebhookError | null = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          await this.deliver(normalizedUrl, rawJsonBody, signature, timestamp);
          this.logger.info({ taskId, url: normalizedUrl }, 'Webhook delivered successfully');
          return { ok: true, value: undefined };
        } catch (error) {
          lastError = this.classifyError(error);

          this.logger.warn(
            {
              taskId,
              errorType: lastError.type,
              errorMessage: lastError.message,
              attempt: attempt + 1,
              [SKIP_SENTRY_KEY]: true,
            },
            'Webhook delivery attempt failed'
          );

          // Don't retry on 4xx errors (client errors)
          if (lastError.type === '4xx') {
            return { ok: false, error: lastError };
          }

          // Wait before retry (exponential backoff)
          if (attempt < MAX_RETRIES - 1) {
            /* v8 ignore start -- ts-type: nullish coalescing on array access creates type narrowing branch @preserve */
            const delay = RETRY_DELAYS[attempt] ?? 5000;
            /* v8 ignore stop @preserve */
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      // All retries failed - add to pending queue
      await this.addToPendingQueue({
        url: normalizedUrl,
        secret,
        payload,
        taskId,
        attempts: MAX_RETRIES,
        createdAt: Date.now(),
      });

      this.logger.warn({ taskId }, 'Webhook delivery failed, queued for retry');

      /* v8 ignore start -- ts-type: unreachable — retry loop always executes so lastError is guaranteed defined @preserve */
      if (lastError === null) {
        return { ok: false, error: { type: 'network', message: 'Unknown error' } };
      }
      /* v8 ignore stop @preserve */

      return { ok: false, error: lastError };
    } finally {
      this.endTerminalCallback();
    }
  }

  getInFlightCount(): number {
    return this.inFlightCallbacks;
  }

  getTerminalCallbackActivityTotal(): number {
    return this.terminalCallbackActivityTotal;
  }

  async getDrainCallbackSnapshot(): Promise<{
    pendingTerminalCallbacks: number | null;
    terminalCallbackActivityTotal: number;
  }> {
    const activityBefore = this.terminalCallbackActivityTotal;
    const inFlightBefore = this.inFlightCallbacks;
    let persisted: number | null;
    try {
      persisted = await this.statePersistence.getPendingWebhookCountForDrain();
    } catch (error) {
      this.logger.warn({ error }, 'Failed to read pending terminal callbacks for drain snapshot');
      return {
        pendingTerminalCallbacks: null,
        terminalCallbackActivityTotal: this.terminalCallbackActivityTotal,
      };
    }
    const activityAfter = this.terminalCallbackActivityTotal;
    const inFlightAfter = this.inFlightCallbacks;
    const total = persisted === null ? null : persisted + inFlightAfter;

    const stable = activityBefore === activityAfter && inFlightBefore === inFlightAfter;
    const valid =
      persisted !== null &&
      Number.isSafeInteger(persisted) &&
      persisted >= 0 &&
      Number.isSafeInteger(inFlightAfter) &&
      inFlightAfter >= 0 &&
      total !== null &&
      Number.isSafeInteger(total);

    return {
      pendingTerminalCallbacks: stable && valid ? total : null,
      terminalCallbackActivityTotal: activityAfter,
    };
  }

  async retryPending(): Promise<void> {
    await this.retryMutex.runExclusive(async () => {
      await this.retryPendingExclusive();
    });
  }

  private async retryPendingExclusive(): Promise<void> {
    const state = await this.statePersistence.load();

    if (state.pendingWebhooks.length === 0) {
      return;
    }

    this.beginTerminalCallback();
    try {
      const now = Date.now();
      const retryResults: {
        original: PendingWebhook;
        replacement: PendingWebhook | null;
      }[] = [];

      for (const pending of state.pendingWebhooks) {
        // Check TTL (24 hours)
        if (now - pending.createdAt > PENDING_WEBHOOK_TTL) {
          this.logger.warn({ taskId: pending.taskId }, 'Pending webhook expired (24h TTL)');
          retryResults.push({ original: pending, replacement: null });
          continue;
        }

        // Attempt delivery
        let success = false;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const rawJsonBody = JSON.stringify(pending.payload);
            const timestamp = Math.floor(now / 1000);
            const signature = signPayload(rawJsonBody, pending.secret, timestamp);

            const normalizedUrl = normalizeInternalCallbackUrl(pending.url);
            await this.deliver(normalizedUrl, rawJsonBody, signature, timestamp);
            this.logger.info(
              { taskId: pending.taskId, url: normalizedUrl, retryAttempt: pending.attempts + 1 },
              'Pending webhook delivered successfully'
            );
            success = true;
            break;
          } catch (error) {
            const errorType = this.classifyError(error);

            this.logger.warn(
              {
                taskId: pending.taskId,
                errorType: errorType.type,
                errorMessage: errorType.message,
                attempt: attempt + 1,
                [SKIP_SENTRY_KEY]: true,
              },
              'Pending webhook retry attempt failed'
            );

            if (errorType.type === '4xx') {
              break; // Don't retry 4xx
            }

            if (attempt < MAX_RETRIES - 1) {
              /* v8 ignore start -- ts-type: nullish coalescing on array access creates type narrowing branch @preserve */
              const delay = RETRY_DELAYS[attempt] ?? 5000;
              /* v8 ignore stop @preserve */
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }

        retryResults.push({
          original: pending,
          replacement: success ? null : { ...pending, attempts: pending.attempts + 1 },
        });
      }

      // Reconcile only entries from the loaded snapshot. New callbacks may be
      // enqueued while network delivery is in flight and must remain intact.
      await this.statePersistence.modify((s) => {
        for (const result of retryResults) {
          const identity = pendingWebhookIdentity(result.original);
          const index = s.pendingWebhooks.findIndex(
            (candidate) => pendingWebhookIdentity(candidate) === identity
          );
          if (index === -1) {
            this.logger.warn(
              { taskId: result.original.taskId },
              'Pending webhook changed before retry reconciliation'
            );
            continue;
          }
          if (result.replacement === null) {
            s.pendingWebhooks.splice(index, 1);
          } else {
            s.pendingWebhooks[index] = result.replacement;
          }
        }
      });
    } finally {
      this.endTerminalCallback();
    }
  }

  async getPendingCount(): Promise<number> {
    const state = await this.statePersistence.load();
    return state.pendingWebhooks.length;
  }

  private async deliver(
    url: string,
    body: string,
    signature: string,
    timestamp: number
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': String(timestamp),
          'X-Request-Signature': signature,
          'X-Internal-Auth': this.internalAuthToken,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = new Error(
          `HTTP ${String(response.status)}: ${response.statusText}`
        ) as Error & {
          status?: number;
        };
        error.status = response.status;
        throw error;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private classifyError(error: unknown): WebhookError {
    if (error instanceof Error) {
      // Handle timeout (AbortError)
      if (error.name === 'AbortError') {
        return {
          type: 'timeout',
          message: 'Webhook request timed out after 30s',
          originalError: error,
        };
      }

      const status = (error as Error & { status?: number }).status;

      if (status !== undefined && status >= 400 && status < 500) {
        return {
          type: '4xx',
          message: `Client error: ${error.message}`,
          originalError: error,
        };
      }

      if (status !== undefined && status >= 500) {
        return {
          type: '5xx',
          message: `Server error: ${error.message}`,
          originalError: error,
        };
      }

      const cause = getErrorCauseChain(error);
      const causeSuffix = cause !== undefined ? ` (${cause})` : '';

      // TypeError is typically a network/client error, not server error
      const prefix = error.name === 'TypeError' ? 'Network or client error: ' : '';
      return {
        type: 'network',
        message: `${prefix}${error.message}${causeSuffix}`,
        originalError: error,
      };
    }

    return {
      type: 'network',
      message: 'Unknown error',
      originalError: error,
    };
  }

  private async addToPendingQueue(webhook: PendingWebhook): Promise<void> {
    await this.statePersistence.modify((state) => {
      state.pendingWebhooks.push(webhook);
    });
  }
}
