import { describe, expect, it } from 'vitest';

import {
  isVisibleRetainedTestRun,
  selectRetainedTestRuns,
} from '../../../domain/testRuns/retention.js';
import { testRunRecord } from './testRunFixtures.js';

const finished = '2026-07-20T10:05:00.000Z';

function terminal(
  runId: string,
  startedAt: string,
  input: Readonly<{
    verdict?: 'passed' | 'failed';
    lifecycle?: 'completed' | 'stopped';
    artifactStatus?: 'ready' | 'failed' | 'unknown';
  }> = {}
): ReturnType<typeof testRunRecord> {
  const lifecycle = input.lifecycle ?? 'completed';
  const verdict = lifecycle === 'stopped' ? 'not_evaluated' : (input.verdict ?? 'passed');
  const artifactStatus = input.artifactStatus ?? 'ready';
  return testRunRecord({
    runId,
    startedAt,
    updatedAt: finished,
    finishedAt: finished,
    lifecycle,
    verdict,
    artifactDelivery:
      artifactStatus === 'ready'
        ? { status: 'ready', failureCode: null, updatedAt: finished }
        : artifactStatus === 'failed'
          ? {
              status: 'failed',
              failureCode: 'REPORT_PUBLICATION_FAILED',
              updatedAt: finished,
            }
          : {
              status: 'unknown',
              failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT',
              updatedAt: finished,
            },
    terminalWinner: {
      kind: 'release',
      eventId: `terminal_${runId}`,
      payloadDigest: 'f'.repeat(64),
      outcome:
        lifecycle === 'stopped'
          ? 'stopped_not_evaluated'
          : verdict === 'passed'
            ? 'completed_passed'
            : 'completed_failed',
      acknowledgedAt: finished,
    },
  });
}

describe('Test Runs retention selection', () => {
  it('rejects a retention candidate set larger than the bounded repository query', () => {
    const candidates = Array.from({ length: 5 }, (_, index) =>
      terminal(`run_${String(index)}`, `2026-07-20T0${String(index)}:00:00.000Z`)
    );

    expect(() => selectRetainedTestRuns(candidates)).toThrowError(
      'TEST_RUN_RETENTION_QUERY_OVERFLOW'
    );
  });

  it('returns current acceptance plus the latest distinct artifact-ready success', () => {
    const current = testRunRecord({
      runId: 'run_current',
      lifecycle: 'running',
      startedAt: '2026-07-20T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    });
    const success = terminal('run_success', '2026-07-20T11:00:00.000Z');
    const failed = terminal('run_failed', '2026-07-20T10:00:00.000Z', { verdict: 'failed' });
    const selected = selectRetainedTestRuns([failed, success, current]);
    expect(selected.map((record) => record.runId)).toEqual(['run_current', 'run_success']);
  });

  it('treats terminal pending/staged delivery as current acceptance', () => {
    const staged = {
      ...terminal('run_staged', '2026-07-20T12:00:00.000Z'),
      artifactDelivery: { status: 'staged' as const, failureCode: null, updatedAt: finished },
    };
    const success = terminal('run_success', '2026-07-20T11:00:00.000Z');
    expect(selectRetainedTestRuns([success, staged]).map((record) => record.runId)).toEqual([
      'run_staged',
      'run_success',
    ]);
  });

  it('returns latest ready success plus latest failed acceptance when no current exists', () => {
    const newerArtifactFailure = terminal('run_artifact_failed', '2026-07-20T12:00:00.000Z', {
      verdict: 'passed',
      artifactStatus: 'failed',
    });
    const behavioralFailure = terminal('run_behavior_failed', '2026-07-20T11:30:00.000Z', {
      verdict: 'failed',
    });
    const success = terminal('run_success', '2026-07-20T11:00:00.000Z');
    expect(
      selectRetainedTestRuns([success, behavioralFailure, newerArtifactFailure]).map(
        (record) => record.runId
      )
    ).toEqual(['run_artifact_failed', 'run_success']);
  });

  it('never duplicates a run and hides superseded direct IDs', () => {
    const success = terminal('run_success', '2026-07-20T12:00:00.000Z');
    const olderSuccess = terminal('run_old_success', '2026-07-20T11:00:00.000Z');
    const selected = selectRetainedTestRuns([olderSuccess, success]);
    expect(selected.map((record) => record.runId)).toEqual(['run_success']);
    expect(isVisibleRetainedTestRun('run_success', selected)).toBe(true);
    expect(isVisibleRetainedTestRun('run_old_success', selected)).toBe(false);
  });

  it('breaks equal-startedAt ties by run ID exactly like the evaluator retention selector', () => {
    const sameStartedAt = '2026-07-20T12:00:00.000Z';
    const runA = terminal('run-a', sameStartedAt);
    const runZ = terminal('run-z', sameStartedAt);

    expect(selectRetainedTestRuns([runA, runZ]).map((record) => record.runId)).toEqual([
      'run-z',
    ]);
  });
});
