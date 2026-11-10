import { describe, expect, it } from 'vitest';
import { buildDigestMonitoringProjection } from './digestMonitoringProjection.js';

const run = {
  runId: 'r',
  userId: 'u',
  definitionId: 'd',
  recordRole: 'canonical',
  visibilityMigrationId: null,
  scheduledBoundary: '2026-11-10T08:00:00.000Z',
  windowEnd: '2026-11-10T08:00:00.000Z',
  generationStatus: 'completed',
  delivery: { status: 'sent', transportConfirmation: { status: 'pending' } },
};

describe('compact digest monitoring projection', () => {
  it('uses the scheduled boundary for a legacy record without an explicit window end', () => {
    expect(buildDigestMonitoringProjection({ ...run, windowEnd: undefined })?.windowEnd).toBe(
      run.scheduledBoundary
    );
  });
  it('retains confirmation without inventing a delivery timestamp when legacy evidence has none', () => {
    expect(
      buildDigestMonitoringProjection({
        ...run,
        generationStatus: 'failed',
        delivery: { status: 'sent', transportConfirmation: { status: 'delivered' } },
      })
    ).toMatchObject({ outcome: 'delivered', deliveredAt: null });
  });
  it('keeps accepted unconfirmed work pending without copying private run content', () => {
    expect(buildDigestMonitoringProjection({ ...run, summaryMarkdown: 'private content' })).toEqual(
      {
        schemaVersion: 1,
        runId: 'r',
        userId: 'u',
        definitionId: 'd',
        scheduledBoundary: run.scheduledBoundary,
        windowEnd: run.windowEnd,
        outcome: 'pending',
        deliveredAt: null,
      }
    );
  });

  it.each([
    { recordRole: 'audit' },
    { visibilityMigrationId: 'm' },
    { deliveryMode: 'silent' },
    { safeFailureCode: 'OBSOLETE_SCHEDULE_WINDOW' },
    { delivery: { status: 'failed', failureCode: 'SKIPPED_BEFORE_RESUME' } },
  ])('excludes hidden, silent and retired history %j', (patch) => {
    expect(buildDigestMonitoringProjection({ ...run, ...patch })).toBeNull();
  });

  it('preserves skipped cursors and delivery evidence precedence with the original effective timestamp', () => {
    expect(
      buildDigestMonitoringProjection({ ...run, generationStatus: 'skipped_no_activity' })?.outcome
    ).toBe('skipped');
    expect(buildDigestMonitoringProjection({ ...run, generationStatus: 'failed' })?.outcome).toBe(
      'failed'
    );
    expect(
      buildDigestMonitoringProjection({
        ...run,
        delivery: { status: 'sent', transportConfirmation: { status: 'failed' } },
      })?.outcome
    ).toBe('failed');
    expect(
      buildDigestMonitoringProjection({
        ...run,
        generationStatus: 'failed',
        delivery: {
          status: 'failed',
          transportConfirmation: {
            status: 'read',
            deliveredAt: '2026-11-10T08:01:00.000Z',
            readAt: '2026-11-10T09:00:00.000Z',
          },
        },
      })
    ).toMatchObject({ outcome: 'delivered', deliveredAt: '2026-11-10T08:01:00.000Z' });
    expect(
      buildDigestMonitoringProjection({
        ...run,
        delivery: {
          status: 'sent',
          transportConfirmation: { status: 'read', readAt: '2026-11-10T09:00:00.000Z' },
        },
      })?.deliveredAt
    ).toBe('2026-11-10T09:00:00.000Z');
  });
});
