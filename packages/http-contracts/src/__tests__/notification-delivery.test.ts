import { describe, expect, it } from 'vitest';
import {
  notificationContextSchema,
  notificationRunStateSchema,
  transportConfirmationSchema,
} from '../index.js';

describe('notification delivery contracts', () => {
  it('accepts additive acknowledgments and fully numbered successful or failed final parts', () => {
    expect(
      notificationContextSchema.parse({ source: 'calendar', runId: 'run', phase: 'ack' })
    ).toEqual({ source: 'calendar', runId: 'run', phase: 'ack' });
    for (const outcome of ['succeeded', 'failed'])
      expect(
        notificationContextSchema.safeParse({
          source: 'calendar',
          runId: 'run',
          phase: 'final',
          outcome,
          partIndex: 0,
          partCount: 2,
        }).success
      ).toBe(true);
  });
  it.each([
    { source: 'Calendar', runId: 'run', phase: 'ack' },
    { source: 'calendar', runId: '', phase: 'ack' },
    { source: 'calendar', runId: 'run', phase: 'final' },
    {
      source: 'calendar',
      runId: 'run',
      phase: 'final',
      outcome: 'succeeded',
      partIndex: 2,
      partCount: 2,
    },
    { source: 'calendar', runId: 'run', phase: 'ack', text: 'payload' },
  ])('rejects malformed boundary context %j', (value) => {
    expect(notificationContextSchema.safeParse(value).success).toBe(false);
  });
  it('keeps transport acceptance and receipt evidence separate and validates timestamps/stages', () => {
    expect(transportConfirmationSchema.safeParse({ status: 'pending' }).success).toBe(true);
    expect(
      transportConfirmationSchema.safeParse({
        status: 'read',
        deliveredAt: '2026-10-12T13:30:00.000Z',
        readAt: '2026-10-12T13:31:00.000Z',
      }).success
    ).toBe(true);
    expect(transportConfirmationSchema.safeParse({ status: 'sent' }).success).toBe(false);
    expect(
      transportConfirmationSchema.safeParse({ status: 'delivered', deliveredAt: 'bad' }).success
    ).toBe(false);
    expect(
      notificationRunStateSchema.safeParse({ status: 'pending', stage: 'processing' }).success
    ).toBe(true);
    expect(notificationRunStateSchema.safeParse({ status: 'pending', stage: 'sent' }).success).toBe(
      false
    );
  });
});
