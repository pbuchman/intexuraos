import { createHmac } from 'node:crypto';
import type { Result, Logger } from '@intexuraos/common-core';
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
    private readonly logger: Logger
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

    // Attempt delivery with retries
    let lastError: WebhookError | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.deliver(url, rawJsonBody, signature, timestamp);
        return { ok: true, value: undefined };
      } catch (error) {
        lastError = this.classifyError(error);

        // Don't retry on 4xx errors (client errors)
        if (lastError.type === '4xx') {
          return { ok: false, error: lastError };
        }

        // Wait before retry (exponential backoff)
        if (attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAYS[attempt] ?? 5000;
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

    if (lastError === null) {
      return { ok: false, error: { type: 'network', message: 'Unknown error' } };
    }

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
          success = true;
          break;
        } catch (error) {
          const errorType = this.classifyError(error);
          if (errorType.type === '4xx') {
            break; // Don't retry 4xx
          }

          if (attempt < MAX_RETRIES - 1) {
            const delay = RETRY_DELAYS[attempt] ?? 5000;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      if (!success) {
        updatedPending.push({ ...pending, attempts: pending.attempts + 1 });
      }
    }

    // Update state
    state.pendingWebhooks = updatedPending;
    await this.statePersistence.save(state);
  }

  getPendingCount(): number {
    // This needs to be synchronous for the API layer to call
    // We'll need to refactor this to get the count from state
    throw new Error('getPendingCount requires async state loading - refactor needed');
  }

  private async deliver(
    url: string,
    body: string,
    signature: string,
    timestamp: number
  ): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Timestamp': String(timestamp),
        'X-Request-Signature': signature,
      },
      body,
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
      (error as { status: number }).status = response.status;
      throw error;
    }
  }

  private classifyError(error: unknown): WebhookError {
    if (error instanceof Error) {
      const status = (error as { status?: number }).status;

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

      if (error.name === 'TypeError') {
        return {
          type: '5xx',
          message: `Server error: ${error.message}`,
          originalError: error,
        };
      }
    }

    return {
      type: 'network',
      message: error instanceof Error ? error.message : 'Unknown error',
      originalError: error,
    };
  }

  private async addToPendingQueue(webhook: PendingWebhook): Promise<void> {
    const state = await this.statePersistence.load();

    state.pendingWebhooks.push(webhook);
    await this.statePersistence.save(state);
  }
}
