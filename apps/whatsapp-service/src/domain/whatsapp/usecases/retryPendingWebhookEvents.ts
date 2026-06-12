import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from '../utils/logger.js';
import type {
  WhatsAppWebhookEvent,
  WhatsAppWebhookEventRepository,
} from '../ports/repositories.js';
import type { ProcessWebhookEventUseCase } from './processWebhookEventUseCase.js';
import type { WebhookPayload } from '../../../routes/schemas.js';

export interface RetryPendingWebhookEventsInput {
  eventIds?: string[];
  limit?: number;
  olderThanSeconds?: number;
  dryRun?: boolean;
}

export interface RetryPendingWebhookEventResult {
  eventId: string;
  outcome: 'processed' | 'skipped' | 'failed';
  status?: string;
  reason?: string;
}

export interface RetryPendingWebhookEventsResult {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  events: RetryPendingWebhookEventResult[];
}

export interface RetryPendingWebhookEventsDeps {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  processWebhookEventUseCase: ProcessWebhookEventUseCase;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_OLDER_THAN_SECONDS = 120;
const RETRYABLE_STATUSES = new Set(['pending', 'failed']);

export class RetryPendingWebhookEventsUseCase {
  constructor(private readonly deps: RetryPendingWebhookEventsDeps) {}

  async execute(
    input: RetryPendingWebhookEventsInput,
    logger: Logger
  ): Promise<RetryPendingWebhookEventsResult> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const dryRun = input.dryRun ?? false;
    const eventsResult =
      input.eventIds !== undefined && input.eventIds.length > 0
        ? await this.findEventsById(input.eventIds)
        : await this.findRetryableEvents(
            input.olderThanSeconds ?? DEFAULT_OLDER_THAN_SECONDS,
            limit
          );

    if (!eventsResult.ok) {
      return {
        processed: 0,
        skipped: 0,
        failed: 1,
        total: 0,
        events: [
          {
            eventId: 'query',
            outcome: 'failed',
            reason: eventsResult.error,
          },
        ],
      };
    }

    const results: RetryPendingWebhookEventResult[] = [];
    for (const event of eventsResult.value) {
      if (!RETRYABLE_STATUSES.has(event.status)) {
        results.push({
          eventId: event.id,
          outcome: 'skipped',
          status: event.status,
          reason: 'terminal_status',
        });
        continue;
      }

      if (dryRun) {
        results.push({
          eventId: event.id,
          outcome: 'skipped',
          status: event.status,
          reason: 'dry_run',
        });
        continue;
      }

      logger.info({ eventId: event.id, status: event.status }, 'Retrying WhatsApp webhook event');

      try {
        const processResult = await this.deps.processWebhookEventUseCase.execute(
          event.payload as WebhookPayload,
          { id: event.id },
          logger
        );

        if (processResult?.ok === false) {
          results.push({
            eventId: event.id,
            outcome: 'failed',
            status: 'failed',
            reason: processResult.failureDetails,
          });
          continue;
        }

        const updatedResult = await this.deps.webhookEventRepository.getEvent(event.id);
        if (!updatedResult.ok) {
          results.push({
            eventId: event.id,
            outcome: 'failed',
            reason: updatedResult.error.message,
          });
          continue;
        }

        const updated = updatedResult.value;
        if (updated === null) {
          results.push({
            eventId: event.id,
            outcome: 'failed',
            reason: 'event_missing_after_retry',
          });
          continue;
        }

        if (updated.status === 'failed' || updated.status === 'pending') {
          results.push({
            eventId: event.id,
            outcome: 'failed',
            status: updated.status,
            reason: updated.failureDetails ?? 'retry_did_not_complete',
          });
          continue;
        }

        const outcome: RetryPendingWebhookEventResult = {
          eventId: event.id,
          outcome: updated.status === 'completed' ? 'processed' : 'skipped',
          status: updated.status,
        };
        if (updated.status !== 'completed') {
          outcome.reason = 'non_bookmark_terminal_status';
        }
        results.push(outcome);
      } catch (error) {
        results.push({
          eventId: event.id,
          outcome: 'failed',
          reason: getErrorMessage(error, 'Unknown retry error'),
        });
      }
    }

    return summarizeResults(results);
  }

  private async findEventsById(
    eventIds: string[]
  ): Promise<{ ok: true; value: WhatsAppWebhookEvent[] } | { ok: false; error: string }> {
    const events: WhatsAppWebhookEvent[] = [];
    for (const eventId of eventIds) {
      const result = await this.deps.webhookEventRepository.getEvent(eventId);
      if (!result.ok) {
        return { ok: false, error: result.error.message };
      }
      if (result.value !== null) {
        events.push(result.value);
      }
    }
    return { ok: true, value: events };
  }

  private async findRetryableEvents(
    olderThanSeconds: number,
    limit: number
  ): Promise<{ ok: true; value: WhatsAppWebhookEvent[] } | { ok: false; error: string }> {
    const olderThan = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
    const result = await this.deps.webhookEventRepository.findRetryableEvents({
      olderThan,
      limit,
    });
    if (!result.ok) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, value: result.value };
  }
}

function summarizeResults(
  events: RetryPendingWebhookEventResult[]
): RetryPendingWebhookEventsResult {
  return {
    processed: events.filter((event) => event.outcome === 'processed').length,
    skipped: events.filter((event) => event.outcome === 'skipped').length,
    failed: events.filter((event) => event.outcome === 'failed').length,
    total: events.length,
    events,
  };
}
