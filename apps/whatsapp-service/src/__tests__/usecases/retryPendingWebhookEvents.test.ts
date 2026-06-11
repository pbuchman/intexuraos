import { beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import {
  RetryPendingWebhookEventsUseCase,
  type ProcessWebhookEventResult,
  type ProcessWebhookEventUseCase,
  type WebhookProcessingStatus,
  type WhatsAppError,
  type WhatsAppWebhookEvent,
  type WhatsAppWebhookEventRepository,
} from '../../domain/whatsapp/index.js';
import type { Logger } from '../../domain/whatsapp/utils/logger.js';

const logger: Logger = {
  info: (): void => {
    // No-op: test logger
  },
  error: (): void => {
    // No-op: test logger
  },
};

function createEvent(overrides: Partial<WhatsAppWebhookEvent> = {}): WhatsAppWebhookEvent {
  return {
    id: 'event-1',
    payload: {},
    signatureValid: true,
    receivedAt: '2020-01-01T00:00:00.000Z',
    phoneNumberId: '123456789012345',
    status: 'pending',
    ...overrides,
  };
}

class TestWebhookEventRepository implements WhatsAppWebhookEventRepository {
  readonly events = new Map<string, WhatsAppWebhookEvent>();
  readonly failedGetEventIds = new Set<string>();
  failFindRetryable = false;
  lastFindRetryableOptions: { olderThan: string; limit: number } | undefined;

  saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>> {
    const saved = { id: `event-${String(this.events.size + 1)}`, ...event };
    this.events.set(saved.id, saved);
    return Promise.resolve(ok(saved));
  }

  updateEventStatus(
    eventId: string,
    status: WebhookProcessingStatus,
    metadata: {
      failureDetails?: string;
      retryable?: boolean;
    }
  ): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>> {
    const existing = this.events.get(eventId);
    if (existing === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Event not found' }));
    }
    const updated: WhatsAppWebhookEvent = {
      ...existing,
      status,
      failureDetails: metadata.failureDetails,
      retryable: status === 'failed' ? (metadata.retryable ?? false) : false,
      processedAt: new Date().toISOString(),
    };
    this.events.set(eventId, updated);
    return Promise.resolve(ok(updated));
  }

  getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, WhatsAppError>> {
    if (this.failedGetEventIds.has(eventId)) {
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: `Failed to get ${eventId}` }));
    }
    return Promise.resolve(ok(this.events.get(eventId) ?? null));
  }

  findRetryableEvents(options: {
    olderThan: string;
    limit: number;
  }): Promise<Result<WhatsAppWebhookEvent[], WhatsAppError>> {
    this.lastFindRetryableOptions = options;
    if (this.failFindRetryable) {
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Failed to query retryable events' })
      );
    }
    const events = Array.from(this.events.values())
      .filter(
        (event) =>
          (event.status === 'pending' || (event.status === 'failed' && event.retryable === true)) &&
          event.receivedAt < options.olderThan
      )
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .slice(0, options.limit);
    return Promise.resolve(ok(events));
  }

  setEvent(event: WhatsAppWebhookEvent): void {
    this.events.set(event.id, event);
  }

  deleteEvent(eventId: string): void {
    this.events.delete(eventId);
  }
}

type ProcessHandler = (
  event: WhatsAppWebhookEvent,
  repository: TestWebhookEventRepository
) => Promise<ProcessWebhookEventResult>;

function createProcessWebhookEventUseCase(
  repository: TestWebhookEventRepository,
  handler: ProcessHandler
): ProcessWebhookEventUseCase {
  return {
    execute: async (_payload, savedEvent): Promise<ProcessWebhookEventResult> => {
      const event = repository.events.get(savedEvent.id);
      if (event === undefined) {
        throw new Error(`Event ${savedEvent.id} missing from test repository`);
      }
      return await handler(event, repository);
    },
  } as ProcessWebhookEventUseCase;
}

describe('RetryPendingWebhookEventsUseCase', () => {
  let repository: TestWebhookEventRepository;

  beforeEach(() => {
    repository = new TestWebhookEventRepository();
  });

  function createUseCase(handler: ProcessHandler): RetryPendingWebhookEventsUseCase {
    return new RetryPendingWebhookEventsUseCase({
      webhookEventRepository: repository,
      processWebhookEventUseCase: createProcessWebhookEventUseCase(repository, handler),
    });
  }

  it('returns a failed query result when automatic retry lookup fails', async () => {
    repository.failFindRetryable = true;
    const before = Date.now();

    const result = await createUseCase(async () => undefined).execute({}, logger);

    expect(result).toMatchObject({
      processed: 0,
      skipped: 0,
      failed: 1,
      total: 0,
      events: [
        {
          eventId: 'query',
          outcome: 'failed',
          reason: 'Failed to query retryable events',
        },
      ],
    });
    expect(repository.lastFindRetryableOptions?.limit).toBe(50);
    const olderThan = Date.parse(repository.lastFindRetryableOptions?.olderThan ?? '');
    expect(olderThan).toBeGreaterThanOrEqual(before - 121_000);
    expect(olderThan).toBeLessThanOrEqual(Date.now() - 119_000);
  });

  it('clamps automatic retry limits and supports dry runs', async () => {
    repository.setEvent(createEvent({ id: 'event-dry-run' }));

    const result = await createUseCase(async () => {
      throw new Error('dry run should not process events');
    }).execute({ limit: 999, olderThanSeconds: 0, dryRun: true }, logger);

    expect(repository.lastFindRetryableOptions?.limit).toBe(100);
    expect(result).toMatchObject({
      processed: 0,
      skipped: 1,
      failed: 0,
      total: 1,
      events: [{ eventId: 'event-dry-run', outcome: 'skipped', reason: 'dry_run' }],
    });
  });

  it('returns a failed query result when exact event lookup fails', async () => {
    repository.failedGetEventIds.add('event-get-fails');

    const result = await createUseCase(async () => undefined).execute(
      { eventIds: ['event-get-fails'] },
      logger
    );

    expect(result).toMatchObject({
      failed: 1,
      total: 0,
      events: [{ eventId: 'query', outcome: 'failed', reason: 'Failed to get event-get-fails' }],
    });
  });

  it('ignores missing exact event ids', async () => {
    const result = await createUseCase(async () => undefined).execute(
      { eventIds: ['event-missing'] },
      logger
    );

    expect(result).toMatchObject({
      processed: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      events: [],
    });
  });

  it('skips terminal events before dry-run retryable events', async () => {
    repository.setEvent(createEvent({ id: 'event-completed', status: 'completed' }));
    repository.setEvent(createEvent({ id: 'event-pending' }));

    const result = await createUseCase(async () => {
      throw new Error('skipped events should not be processed');
    }).execute({ eventIds: ['event-completed', 'event-pending'], dryRun: true }, logger);

    expect(result).toMatchObject({
      processed: 0,
      skipped: 2,
      failed: 0,
      total: 2,
      events: [
        {
          eventId: 'event-completed',
          outcome: 'skipped',
          status: 'completed',
          reason: 'terminal_status',
        },
        {
          eventId: 'event-pending',
          outcome: 'skipped',
          status: 'pending',
          reason: 'dry_run',
        },
      ],
    });
  });

  it('records failures returned by the webhook processor', async () => {
    repository.setEvent(createEvent({ id: 'event-process-fails' }));

    const result = await createUseCase(async () => ({
      ok: false,
      retryable: true,
      failureDetails: 'processor failed',
    })).execute({ eventIds: ['event-process-fails'] }, logger);

    expect(result).toMatchObject({
      processed: 0,
      skipped: 0,
      failed: 1,
      total: 1,
      events: [
        {
          eventId: 'event-process-fails',
          outcome: 'failed',
          status: 'failed',
          reason: 'processor failed',
        },
      ],
    });
  });

  it('records failures when the updated event cannot be loaded', async () => {
    repository.setEvent(createEvent({ id: 'event-updated-read-fails' }));
    repository.failedGetEventIds.add('event-updated-read-fails');

    const result = await createUseCase(async () => undefined).execute({}, logger);

    expect(result).toMatchObject({
      failed: 1,
      total: 1,
      events: [
        {
          eventId: 'event-updated-read-fails',
          outcome: 'failed',
          reason: 'Failed to get event-updated-read-fails',
        },
      ],
    });
  });

  it('records failures when the updated event disappears after retry', async () => {
    repository.setEvent(createEvent({ id: 'event-deleted' }));

    const result = await createUseCase(async (event, repo) => {
      repo.deleteEvent(event.id);
      return undefined;
    }).execute({}, logger);

    expect(result).toMatchObject({
      failed: 1,
      total: 1,
      events: [
        {
          eventId: 'event-deleted',
          outcome: 'failed',
          reason: 'event_missing_after_retry',
        },
      ],
    });
  });

  it('records failed outcomes for events still pending or failed after retry', async () => {
    repository.setEvent(createEvent({ id: 'event-still-pending' }));
    repository.setEvent(createEvent({ id: 'event-still-failed', status: 'failed', retryable: true }));

    const result = await createUseCase(async (event, repo) => {
      if (event.id === 'event-still-failed') {
        repo.setEvent({
          ...event,
          status: 'failed',
          failureDetails: 'still failing',
          retryable: true,
        });
        return undefined;
      }
      repo.setEvent({ ...event, status: 'pending' });
      return undefined;
    }).execute({}, logger);

    expect(result).toMatchObject({
      processed: 0,
      skipped: 0,
      failed: 2,
      total: 2,
      events: [
        {
          eventId: 'event-still-pending',
          outcome: 'failed',
          status: 'pending',
          reason: 'retry_did_not_complete',
        },
        {
          eventId: 'event-still-failed',
          outcome: 'failed',
          status: 'failed',
          reason: 'still failing',
        },
      ],
    });
  });

  it('classifies completed events as processed and terminal non-bookmark events as skipped', async () => {
    repository.setEvent(createEvent({ id: 'event-completes' }));
    repository.setEvent(createEvent({ id: 'event-ignored' }));

    const result = await createUseCase(async (event, repo) => {
      repo.setEvent({
        ...event,
        status: event.id === 'event-completes' ? 'completed' : 'ignored',
      });
      return undefined;
    }).execute({}, logger);

    expect(result).toMatchObject({
      processed: 1,
      skipped: 1,
      failed: 0,
      total: 2,
      events: [
        {
          eventId: 'event-completes',
          outcome: 'processed',
          status: 'completed',
        },
        {
          eventId: 'event-ignored',
          outcome: 'skipped',
          status: 'ignored',
          reason: 'non_bookmark_terminal_status',
        },
      ],
    });
  });

  it('records thrown processor errors', async () => {
    repository.setEvent(createEvent({ id: 'event-throws' }));

    const result = await createUseCase(async () => {
      throw new Error('processor threw');
    }).execute({}, logger);

    expect(result).toMatchObject({
      failed: 1,
      total: 1,
      events: [
        {
          eventId: 'event-throws',
          outcome: 'failed',
          reason: 'processor threw',
        },
      ],
    });
  });
});
