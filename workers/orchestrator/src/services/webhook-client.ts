import { createHmac } from 'node:crypto';
import { getErrorCauseChain, type Result, type Logger } from '@intexuraos/common-core';
import type { StatePersistence } from './state-persistence.js';
import type { PendingWebhook } from '../types/state.js';

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

export class WebhookClient {
  constructor(
    private readonly statePersistence: StatePersistence,
    private readonly logger: Logger,
    private readonly internalAuthToken: string
  ) {}

  async send(params: {
    url: string;
    secret: string;
    payload: unknown;
    taskId: string;
  }): Promise<Result<void, WebhookError>> {
    const { url, secret, payload, taskId } = params;

    // Serialize payload to JSON
    const rawJsonBody = JSON.stringify(payload);

    // Generate signature
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(rawJsonBody, secret, timestamp);

    this.logger.info({ taskId, url, payload }, 'Sending webhook');

    // Attempt delivery with retries
    let lastError: WebhookError | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.deliver(url, rawJsonBody, signature, timestamp);
        this.logger.info({ taskId, url }, 'Webhook delivered successfully');
        return { ok: true, value: undefined };
      } catch (error) {
        lastError = this.classifyError(error);

        this.logger.warn(
          {
            taskId,
            errorType: lastError.type,
            errorMessage: lastError.message,
            attempt: attempt + 1,
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
      url,
      secret,
      payload,
      taskId,
      attempts: MAX_RETRIES,
      createdAt: Date.now(),
    });

    this.logger.warn({ taskId }, 'Webhook delivery failed, queued for retry');

    /* v8 ignore start -- ts-type: loop always executes so lastError is never null @preserve */
    if (lastError === null) {
      return { ok: false, error: { type: 'network', message: 'Unknown error' } };
    }
    /* v8 ignore stop @preserve */

    return { ok: false, error: lastError };
  }

  async retryPending(): Promise<void> {
    const state = await this.statePersistence.load();

    if (state.pendingWebhooks.length === 0) {
      return;
    }

    const now = Date.now();
    const updatedPending: PendingWebhook[] = [];

    for (const pending of state.pendingWebhooks) {
      // Check TTL (24 hours)
      if (now - pending.createdAt > PENDING_WEBHOOK_TTL) {
        this.logger.warn({ taskId: pending.taskId }, 'Pending webhook expired (24h TTL)');
        continue;
      }

      // Attempt delivery
      let success = false;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const rawJsonBody = JSON.stringify(pending.payload);
          const timestamp = Math.floor(now / 1000);
          const signature = signPayload(rawJsonBody, pending.secret, timestamp);

          await this.deliver(pending.url, rawJsonBody, signature, timestamp);
          this.logger.info(
            { taskId: pending.taskId, url: pending.url, retryAttempt: pending.attempts + 1 },
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

      if (!success) {
        updatedPending.push({ ...pending, attempts: pending.attempts + 1 });
      }
    }

    // Update state
    await this.statePersistence.modify((s) => {
      s.pendingWebhooks = updatedPending;
    });
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
