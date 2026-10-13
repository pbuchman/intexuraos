import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { runDueSchedules } from '../../../domain/schedules/runDueSchedules.js';
import type { ClaimedCalendarSchedule } from '../../../domain/index.js';
import { FakeCalendarScheduleRepository, FakeWhatsAppScheduleClient } from '../../fakes.js';

function claimedSchedule(): ClaimedCalendarSchedule {
  return {
    schedule: {
      id: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      status: 'active',
      cadence: { type: 'daily', localTime: '09:00', timeZone: 'America/New_York' },
      payload: {
        prompt: 'Send me events that they have in the calendar in the next 24 hours.',
        target: 'intex_agent',
      },
      nextRunAt: '2026-07-04T13:00:00.000Z',
      schemaVersion: 1,
    },
    localDate: '2026-07-04',
    scheduledFor: '2026-07-04T13:00:00.000Z',
    startedAt: '2026-07-04T13:00:10.000Z',
  };
}

describe('runDueSchedules', () => {
  it('reuses byte-identical Matrix payloads on later same-day retries', async () => {
    const repository = new FakeCalendarScheduleRepository();
    repository.setClaimDueSchedulesResult(ok([claimedSchedule()]));
    const client = new FakeWhatsAppScheduleClient();
    client.setSendOutboundMatrixMessageResult(err(new Error('temporary transport failure')));
    const deps = {
      scheduleRepository: repository,
      whatsAppScheduleClient: client,
      logger: console as never,
    };
    await runDueSchedules(
      { now: '2026-07-04T13:00:10.000Z', batchSize: 10, leaseOwnerId: 'one' },
      deps
    );
    await runDueSchedules(
      { now: '2026-07-04T13:15:10.000Z', batchSize: 10, leaseOwnerId: 'two' },
      deps
    );
    expect(client.sendOutboundMatrixMessageCalls[1]).toEqual(
      client.sendOutboundMatrixMessageCalls[0]
    );
  });

  it('sends a lookahead from actual execution time and records Matrix acceptance', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setClaimDueSchedulesResult(ok([claimedSchedule()]));

    const result = await runDueSchedules(
      {
        now: '2026-07-04T13:00:10.000Z',
        batchSize: 10,
        leaseOwnerId: 'worker-c',
      },
      {
        scheduleRepository: repository as never,
        whatsAppScheduleClient: whatsappClient as never,
        logger: console as never,
      }
    );

    expect(result.ok).toBe(true);
    expect(whatsappClient.sendOutboundMatrixMessageCalls).toEqual([
      {
        userId: 'user-123',
        target: 'intex_agent',
        text: 'Send me events that they have in the calendar in the next 24 hours. Look ahead from the current time when processing this request, for the next 24 hours.',
        notificationContext: {
          source: 'calendar',
          runId: 'user-123_calendar_daily_lookahead_2026-07-04',
          phase: 'ack',
        },
        scheduledFor: '2026-07-04T13:00:00.000Z',
        startNewSession: true,
        idempotencyKey: 'calendar:user-123_calendar_daily_lookahead:2026-07-04',
      },
    ]);
    expect(repository.markRunSentCalls).toHaveLength(1);
    expect(repository.markRunSentCalls[0]).toMatchObject({
      scheduleId: 'user-123_calendar_daily_lookahead',
      localDate: '2026-07-04',
      matrixEventId: '$event-123',
      nextRunAt: '2026-07-05T13:00:00.000Z',
    });
  });

  it('records setup-required responses as failed and schedules the next daily run', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setClaimDueSchedulesResult(ok([claimedSchedule()]));
    whatsappClient.setSendOutboundMatrixMessageResult(
      ok({ status: 'setup_required', reason: 'Matrix outbound mapping missing' })
    );

    const result = await runDueSchedules(
      {
        now: '2026-07-04T13:00:10.000Z',
        batchSize: 10,
        leaseOwnerId: 'worker-c',
      },
      {
        scheduleRepository: repository as never,
        whatsAppScheduleClient: whatsappClient as never,
        logger: console as never,
      }
    );

    expect(result.ok).toBe(true);
    expect(repository.markRunFailedCalls).toHaveLength(1);
    expect(repository.markRunFailedCalls[0]).toMatchObject({
      error: 'Matrix outbound mapping missing',
      retryable: false,
      nextRunAt: '2026-07-05T13:00:00.000Z',
    });
  });

  it('records adapter error responses as retryable failures', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setClaimDueSchedulesResult(ok([claimedSchedule()]));
    whatsappClient.setSendOutboundMatrixMessageResult(
      ok({ status: 'error', message: 'Matrix adapter send response was invalid' })
    );

    const result = await runDueSchedules(
      {
        now: '2026-07-04T13:00:10.000Z',
        batchSize: 10,
        leaseOwnerId: 'worker-c',
      },
      {
        scheduleRepository: repository as never,
        whatsAppScheduleClient: whatsappClient as never,
        logger: console as never,
      }
    );

    expect(result.ok).toBe(true);
    expect(repository.markRunSentCalls).toHaveLength(0);
    expect(repository.markRunFailedCalls).toHaveLength(1);
    expect(repository.markRunFailedCalls[0]).toMatchObject({
      error: 'Matrix adapter send response was invalid',
      retryable: true,
      nextRunAt: '2026-07-04T13:15:10.000Z',
    });
  });

  it('returns mark-failed errors after an adapter error response', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setClaimDueSchedulesResult(ok([claimedSchedule()]));
    whatsappClient.setSendOutboundMatrixMessageResult(
      ok({ status: 'error', message: 'Matrix adapter send response was invalid' })
    );
    repository.setMarkRunFailedResult(
      err({ code: 'INTERNAL_ERROR', message: 'mark failed failed' })
    );

    const result = await runDueSchedules(
      {
        now: '2026-07-04T13:00:10.000Z',
        batchSize: 10,
        leaseOwnerId: 'worker-c',
      },
      {
        scheduleRepository: repository as never,
        whatsAppScheduleClient: whatsappClient as never,
        logger: console as never,
      }
    );

    expect(result.ok).toBe(false);
    expect(repository.markRunFailedCalls).toHaveLength(1);
  });

  it('retries transport failures in 15 minutes', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setClaimDueSchedulesResult(ok([claimedSchedule()]));
    whatsappClient.setSendOutboundMatrixMessageResult(err(new Error('socket hang up')));

    const result = await runDueSchedules(
      {
        now: '2026-07-04T13:00:10.000Z',
        batchSize: 10,
        leaseOwnerId: 'worker-c',
      },
      {
        scheduleRepository: repository as never,
        whatsAppScheduleClient: whatsappClient as never,
        logger: console as never,
      }
    );

    expect(result.ok).toBe(true);
    expect(repository.markRunFailedCalls).toHaveLength(1);
    expect(repository.markRunFailedCalls[0]).toMatchObject({
      error: 'socket hang up',
      retryable: true,
      nextRunAt: '2026-07-04T13:15:10.000Z',
    });
  });

  it('returns claim errors without sending messages', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setClaimDueSchedulesResult(err({ code: 'INTERNAL_ERROR', message: 'claim failed' }));

    const result = await runDueSchedules(
      {
        now: '2026-07-04T13:00:10.000Z',
        batchSize: 10,
        leaseOwnerId: 'worker-c',
      },
      {
        scheduleRepository: repository as never,
        whatsAppScheduleClient: whatsappClient as never,
        logger: console as never,
      }
    );

    expect(result.ok).toBe(false);
    expect(whatsappClient.sendOutboundMatrixMessageCalls).toHaveLength(0);
  });

  it('returns mark-sent errors after a successful send', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setClaimDueSchedulesResult(ok([claimedSchedule()]));
    repository.setMarkRunSentResult(err({ code: 'INTERNAL_ERROR', message: 'mark sent failed' }));

    const result = await runDueSchedules(
      {
        now: '2026-07-04T13:00:10.000Z',
        batchSize: 10,
        leaseOwnerId: 'worker-c',
      },
      {
        scheduleRepository: repository as never,
        whatsAppScheduleClient: whatsappClient as never,
        logger: console as never,
      }
    );

    expect(result.ok).toBe(false);
    expect(repository.markRunSentCalls).toHaveLength(1);
  });

  it('returns mark-failed errors after a failed send', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setClaimDueSchedulesResult(ok([claimedSchedule()]));
    whatsappClient.setSendOutboundMatrixMessageResult(err(new Error('socket hang up')));
    repository.setMarkRunFailedResult(
      err({ code: 'INTERNAL_ERROR', message: 'mark failed failed' })
    );

    const result = await runDueSchedules(
      {
        now: '2026-07-04T13:00:10.000Z',
        batchSize: 10,
        leaseOwnerId: 'worker-c',
      },
      {
        scheduleRepository: repository as never,
        whatsAppScheduleClient: whatsappClient as never,
        logger: console as never,
      }
    );

    expect(result.ok).toBe(false);
    expect(repository.markRunFailedCalls).toHaveLength(1);
  });

  it('returns mark-failed errors after a setup-required send response', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setClaimDueSchedulesResult(ok([claimedSchedule()]));
    whatsappClient.setSendOutboundMatrixMessageResult(
      ok({ status: 'setup_required', reason: 'Matrix outbound mapping missing' })
    );
    repository.setMarkRunFailedResult(
      err({ code: 'INTERNAL_ERROR', message: 'mark failed failed' })
    );

    const result = await runDueSchedules(
      {
        now: '2026-07-04T13:00:10.000Z',
        batchSize: 10,
        leaseOwnerId: 'worker-c',
      },
      {
        scheduleRepository: repository as never,
        whatsAppScheduleClient: whatsappClient as never,
        logger: console as never,
      }
    );

    expect(result.ok).toBe(false);
    expect(repository.markRunFailedCalls).toHaveLength(1);
  });
  it.each([
    ['pending', 'processing', false, 'pending'],
    ['delivered', 'delivered', false, 'delivered'],
    ['failed', 'failed', false, 'failed'],
    ['pending', 'awaiting_delivery', true, 'failed'],
  ] as const)(
    'reconciles %s/%s receipt expired=%s before claiming more work',
    async (status, stage, expired, expected) => {
      const run = {
        id: 'calendar_2026-07-04',
        scheduleId: 'calendar',
        userId: 'u',
        taskType: 'calendar_daily_lookahead' as const,
        status: 'sent' as const,
        deliveryStatus: 'pending' as const,
        stage: 'awaiting_ingress' as const,
        localDate: '2026-07-04',
        scheduledFor: '2026-07-04T13:00:00.000Z',
        startedAt: '2026-07-04T13:00:00.000Z',
      };
      const repository = Object.assign(new FakeCalendarScheduleRepository(), {
        listPendingRuns: vi.fn().mockResolvedValue(ok([run])),
        markRunDelivery: vi.fn().mockResolvedValue(ok(undefined)),
      });
      repository.setClaimDueSchedulesResult(ok([]));
      const client = Object.assign(new FakeWhatsAppScheduleClient(), {
        getNotificationRunState: vi.fn().mockResolvedValue(
          ok({
            status,
            stage,
            ...(status === 'delivered' ? { deliveredAt: '2026-07-04T13:01:00.000Z' } : {}),
            ...(status === 'failed' ? { failureCode: 'FAILED_FINAL' } : {}),
          })
        ),
      });
      const result = await runDueSchedules(
        {
          now: expired ? '2026-07-04T20:00:00.000Z' : '2026-07-04T13:05:00.000Z',
          batchSize: 10,
          leaseOwnerId: 'owner',
        },
        { scheduleRepository: repository, whatsAppScheduleClient: client, logger: console as never }
      );
      expect(result.ok).toBe(true);
      expect(client.getNotificationRunState).toHaveBeenCalledWith({
        userId: 'u',
        source: 'calendar',
        runId: run.id,
      });
      expect(repository.markRunDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expected,
          stage: expired ? 'failed' : stage,
          ...(expired ? { failureCode: 'DELIVERY_EXPIRED' } : {}),
        })
      );
      expect(client.sendOutboundMatrixMessageCalls).toHaveLength(0);
    }
  );
  it('does not rewrite unchanged pending delivery state', async () => {
    const run = {
      id: 'r',
      userId: 'u',
      stage: 'processing',
      deliveryStatus: 'pending',
      startedAt: '2026-07-04T13:00:00.000Z',
    };
    const repository = Object.assign(new FakeCalendarScheduleRepository(), {
      listPendingRuns: vi.fn().mockResolvedValue(ok([run])),
      markRunDelivery: vi.fn(),
    });
    repository.setClaimDueSchedulesResult(ok([]));
    const client = Object.assign(new FakeWhatsAppScheduleClient(), {
      getNotificationRunState: vi
        .fn()
        .mockResolvedValue(ok({ status: 'pending', stage: 'processing' })),
    });
    await runDueSchedules(
      { now: '2026-07-04T13:05:00.000Z', batchSize: 1, leaseOwnerId: 'owner' },
      { scheduleRepository: repository, whatsAppScheduleClient: client, logger: console as never }
    );
    expect(repository.markRunDelivery).not.toHaveBeenCalled();
  });
  it.each(['list', 'observe', 'record'])(
    'propagates %s storage/observation failures',
    async (failure) => {
      const error = err({ code: 'INTERNAL_ERROR' as const, message: 'Unavailable' });
      const repository = Object.assign(new FakeCalendarScheduleRepository(), {
        listPendingRuns: vi
          .fn()
          .mockResolvedValue(
            failure === 'list'
              ? error
              : ok([{ id: 'r', userId: 'u', startedAt: '2026-07-04T13:00:00.000Z' }])
          ),
        markRunDelivery: vi.fn().mockResolvedValue(error),
      });
      const client = Object.assign(new FakeWhatsAppScheduleClient(), {
        getNotificationRunState: vi
          .fn()
          .mockResolvedValue(
            failure === 'observe' ? err(new Error('Unavailable')) : ok({ status: 'failed' })
          ),
      });
      const result = await runDueSchedules(
        { now: '2026-07-04T13:05:00.000Z', batchSize: 1, leaseOwnerId: 'owner' },
        { scheduleRepository: repository, whatsAppScheduleClient: client, logger: console as never }
      );
      expect(result.ok).toBe(false);
      expect(client.sendOutboundMatrixMessageCalls).toHaveLength(0);
    }
  );
});
