import { describe, expect, it } from 'vitest';

import { deriveAggregateStatusFromSummary } from '../../../domain/issueGrouping/index.js';

const base = {
  activeTaskCount: 0,
  hasCompletedPlanning: false,
  hasCompletedExecution: false,
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

  it('returns needs-action when execution completed with PR and review says no remediation needed', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedExecution: true,
        hasPrUrl: true,
        latestReviewNeedsRemediation: false,
      }),
    ).toBe('needs-action');
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

  it('does not return needs-action when latestReviewNeedsRemediation is null (no review yet)', () => {
    const result = deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedExecution: true,
      hasPrUrl: true,
      latestReviewNeedsRemediation: null,
    });
    expect(result).not.toBe('needs-action');
  });

  it('does not return needs-action when latestReviewNeedsRemediation is true (needs remediation)', () => {
    const result = deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedExecution: true,
      hasPrUrl: true,
      latestReviewNeedsRemediation: true,
    });
    expect(result).not.toBe('needs-action');
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

  it('returns needs-action via rule 3 when both planning and execution completed', () => {
    expect(
      deriveAggregateStatusFromSummary({
        ...base,
        hasCompletedPlanning: true,
        hasCompletedExecution: true,
        hasPrUrl: true,
        latestReviewNeedsRemediation: false,
      }),
    ).toBe('needs-action');
  });
});
