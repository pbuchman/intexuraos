import { describe, expect, it } from 'vitest';

import { deriveAggregateStatusFromSummary } from '../../../domain/issueGrouping/index.js';

const base = {
  activeTaskCount: 0,
  hasCompletedPlanning: false,
  hasCompletedExecution: false,
  hasCompletedExecutionAgent: false,
  hasImplementationTaskId: false,
  hasPrUrl: false,
  latestTaskStatus: 'done',
  latestReviewNeedsRemediation: null,
};

describe('deriveAggregateStatusFromSummary', () => {
  it('returns active when activeTaskCount > 0', () => {
    expect(deriveAggregateStatusFromSummary({ ...base, activeTaskCount: 1 })).toBe('active');
  });

  it('returns active when activeTaskCount > 0 even if other conditions for needs-action are true', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        activeTaskCount: 2,
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasImplementationTaskId: false,
      }),
    ).toBe('active');
  });

  it('returns active when execution agent completed but no review yet (latestReviewNeedsRemediation is null)', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecutionAgent: true,
        latestReviewNeedsRemediation: null,
      }),
    ).toBe('active');
  });

  it('does not return active when execution completed with no review but hasMergeReadyLabel is true', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecutionAgent: true,
        latestReviewNeedsRemediation: null,
        hasMergeReadyLabel: true,
      }),
    ).not.toBe('active');
  });

  it('returns active when execution agent completed and review needs remediation (latestReviewNeedsRemediation is true)', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecutionAgent: true,
        latestReviewNeedsRemediation: true,
      }),
    ).toBe('active');
  });

  it('does not return active for execution-agent-completed when review passed (latestReviewNeedsRemediation is false)', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecutionAgent: true,
        latestReviewNeedsRemediation: false,
      }),
    ).not.toBe('active');
  });

  it('does not return active for hasCompletedExecutionAgent when activeTaskCount also > 0 (still active via rule 1)', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        activeTaskCount: 1,
        hasCompletedExecutionAgent: true,
        latestReviewNeedsRemediation: null,
      }),
    ).toBe('active');
  });

  it('does not trigger rule 1b when hasCompletedExecution is true but hasCompletedExecutionAgent is false (pull_request workflow)', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecution: true,
        hasCompletedExecutionAgent: false,
        latestReviewNeedsRemediation: null,
      }),
    ).not.toBe('active');
  });

  it('returns needs-action when planning completed, no execution, no implementationTaskId', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasImplementationTaskId: false,
      }),
    ).toBe('needs-action');
  });

  it('returns needs-action when execution completed with PR, review says no remediation, and merge-ready label present', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecution: true,
        hasPrUrl: true,
        latestReviewNeedsRemediation: false,
        hasMergeReadyLabel: true,
      }),
    ).toBe('needs-action');
  });

  it('does not return needs-action for merge case when hasMergeReadyLabel is false', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecution: true,
        hasPrUrl: true,
        latestReviewNeedsRemediation: false,
        hasMergeReadyLabel: false,
      }),
    ).not.toBe('needs-action');
  });

  it('does not return needs-action for merge case when hasMergeReadyLabel is undefined (conservative default)', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecution: true,
        hasPrUrl: true,
        latestReviewNeedsRemediation: false,
      }),
    ).not.toBe('needs-action');
  });

  it('does not return needs-action when hasImplementationTaskId is true (execution in progress)', () => {
    const result = deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedPlanning: true,
      hasCompletedExecution: false,
      hasImplementationTaskId: true,
    });
    expect(result).not.toBe('needs-action');
  });

  it('returns needs-action when PR exists, review not dispatched (null), and merge-ready label present', () => {
    const result = deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedExecution: true,
      hasPrUrl: true,
      latestReviewNeedsRemediation: null,
      hasMergeReadyLabel: true,
    });
    expect(result).toBe('needs-action');
  });

  it('does not return needs-action when latestReviewNeedsRemediation is true (needs remediation)', () => {
    const result = deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedExecution: true,
      hasPrUrl: true,
      latestReviewNeedsRemediation: true,
      hasMergeReadyLabel: true,
    });
    expect(result).not.toBe('needs-action');
  });

  it('returns needs-action when PR exists, review skipped (null), and merge-ready label present (full path)', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecutionAgent: true,
        hasPrUrl: true,
        latestReviewNeedsRemediation: null,
        hasMergeReadyLabel: true,
      }),
    ).toBe('needs-action');
  });

  it('returns failed when latestTaskStatus is failed', () => {
    expect(deriveAggregateStatusFromSummary({ ...base, latestTaskStatus: 'failed' })).toBe('failed');
  });

  it('returns failed when latestTaskStatus is interrupted', () => {
    expect(deriveAggregateStatusFromSummary({ ...base, latestTaskStatus: 'interrupted' })).toBe('failed');
  });

  it.each(['planned', 'implemented', 'reviewed', 'cancelled'])(
    'returns done for latestTaskStatus %s',
    (status) => {
      expect(deriveAggregateStatusFromSummary({ ...base, latestTaskStatus: status })).toBe('done');
    },
  );

  it('returns done when no special conditions are met', () => {
    expect(deriveAggregateStatusFromSummary(base)).toBe('done');
  });

  it('returns active even when latestTaskStatus is failed (active overrides failed)', () => {
    expect(
      deriveAggregateStatusFromSummary({ ...base, activeTaskCount: 1, latestTaskStatus: 'failed' }),
    ).toBe('active');
  });

  it('returns needs-action for merge case even without hasCompletedExecution (review-only workflow)', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecution: false,
        hasPrUrl: true,
        latestReviewNeedsRemediation: false,
        hasMergeReadyLabel: true,
      }),
    ).toBe('needs-action');
  });

  it('returns needs-action via rule 3 when both planning and execution completed and merge-ready label present', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedPlanning: true,
        hasCompletedExecution: true,
        hasPrUrl: true,
        latestReviewNeedsRemediation: false,
        hasMergeReadyLabel: true,
      }),
    ).toBe('needs-action');
  });

  it('returns needs-action for planning case when hasImplementationReadyLabel is undefined (pessimistic default)', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasImplementationTaskId: false,
      }),
    ).toBe('needs-action');
  });

  it('does not return needs-action for planning case when hasImplementationReadyLabel is false', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasImplementationTaskId: false,
        hasImplementationReadyLabel: false,
      }),
    ).not.toBe('needs-action');
  });

  it('returns needs-action for planning case when hasImplementationReadyLabel is true', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedPlanning: true,
        hasCompletedExecution: false,
        hasImplementationTaskId: false,
        hasImplementationReadyLabel: true,
      }),
    ).toBe('needs-action');
  });

  it('returns archived when taskCount is 0', () => {
    expect(
      deriveAggregateStatusFromSummary({ ...base, taskCount: 0 }),
    ).toBe('archived');
  });

  it('returns archived when taskCount is 0 even if active conditions are met', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        taskCount: 0,
        activeTaskCount: 1,
        hasCompletedExecutionAgent: true,
        latestReviewNeedsRemediation: null,
      }),
    ).toBe('archived');
  });

  it('returns archived when taskCount is 0 even if failed conditions are met', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        taskCount: 0,
        latestTaskStatus: 'failed',
      }),
    ).toBe('archived');
  });

  it('does not return archived when taskCount is undefined (backward compat)', () => {
    expect(
      deriveAggregateStatusFromSummary(base),
    ).toBe('done');
  });

  it('does not return archived when taskCount is greater than 0', () => {
    expect(
      deriveAggregateStatusFromSummary({ ...base, taskCount: 1 }),
    ).toBe('done');
  });
});
