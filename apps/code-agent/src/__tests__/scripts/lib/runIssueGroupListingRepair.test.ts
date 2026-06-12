import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import type { RepairArchivedOpenPrGroupsResult } from '../../../domain/usecases/repairArchivedOpenPrGroups.js';
import {
  createRunIssueGroupListingRepair,
  type TaskGroupSummarySortKeyBackfillResult,
} from '../../../scripts/lib/runIssueGroupListingRepair.js';

function makeBackfillResult(overrides: Partial<TaskGroupSummarySortKeyBackfillResult> = {}): TaskGroupSummarySortKeyBackfillResult {
  return {
    dryRun: false,
    scanned: 783,
    updated: 780,
    updates: [],
    ...overrides,
  };
}

function makeArchivedRepairResult(
  overrides: Partial<RepairArchivedOpenPrGroupsResult> = {},
): RepairArchivedOpenPrGroupsResult {
  return {
    dryRun: false,
    totalOpenPrsScanned: 12,
    totalPrTasksFetched: 40,
    groupsEvaluated: 9,
    groupsRepaired: 2,
    groupsSkippedAlreadyVisible: 4,
    groupsSkippedScanLimit: 0,
    prsSkippedScanLimit: 0,
    tasksRestored: 2,
    tasksFailed: 0,
    summaryRecomputeFailures: 0,
    durationMs: 1500,
    warnings: [],
    ...overrides,
  };
}

describe('runIssueGroupListingRepair', () => {
  it('runs the sort-key backfill before archived-open-PR repair and forwards flags', async () => {
    const callOrder: string[] = [];
    const backfillTaskGroupSummarySortKeys = vi.fn(async (input?: { dryRun?: boolean }) => {
      callOrder.push(`backfill:${JSON.stringify(input ?? {})}`);
      return ok(makeBackfillResult({ dryRun: true }));
    });
    const repairArchivedOpenPrGroups = vi.fn(async (input?: { dryRun?: boolean; scanLimit?: number }) => {
      callOrder.push(`repair:${JSON.stringify(input ?? {})}`);
      return ok(makeArchivedRepairResult({ dryRun: true }));
    });

    const runRepair = createRunIssueGroupListingRepair({
      backfillTaskGroupSummarySortKeys,
      repairArchivedOpenPrGroups,
    });
    const result = await runRepair({ dryRun: true, scanLimit: 75 });

    expect(callOrder).toEqual([
      'backfill:{"dryRun":true}',
      'repair:{"dryRun":true,"scanLimit":75}',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        dryRun: true,
        sortKeyBackfill: makeBackfillResult({ dryRun: true }),
        archivedOpenPrRepair: makeArchivedRepairResult({ dryRun: true }),
      });
    }
  });

  it('stops immediately when the sort-key backfill fails', async () => {
    const backfillTaskGroupSummarySortKeys = vi.fn().mockResolvedValue(
      err(new Error('backfill failed')),
    );
    const repairArchivedOpenPrGroups = vi.fn();

    const runRepair = createRunIssueGroupListingRepair({
      backfillTaskGroupSummarySortKeys,
      repairArchivedOpenPrGroups,
    });
    const result = await runRepair();

    expect(result.ok).toBe(false);
    expect(repairArchivedOpenPrGroups).not.toHaveBeenCalled();
  });

  it('returns the archived-open-PR repair failure after a successful backfill', async () => {
    const backfillTaskGroupSummarySortKeys = vi.fn().mockResolvedValue(
      ok(makeBackfillResult()),
    );
    const repairArchivedOpenPrGroups = vi.fn().mockResolvedValue(
      err(new Error('archived repair failed')),
    );

    const runRepair = createRunIssueGroupListingRepair({
      backfillTaskGroupSummarySortKeys,
      repairArchivedOpenPrGroups,
    });
    const result = await runRepair({ scanLimit: 25 });

    expect(result.ok).toBe(false);
    expect(backfillTaskGroupSummarySortKeys).toHaveBeenCalledWith({ dryRun: false });
    expect(repairArchivedOpenPrGroups).toHaveBeenCalledWith({ dryRun: false, scanLimit: 25 });
  });

  it('omits scanLimit when it is not provided', async () => {
    const backfillTaskGroupSummarySortKeys = vi.fn().mockResolvedValue(
      ok(makeBackfillResult({ dryRun: true })),
    );
    const repairArchivedOpenPrGroups = vi.fn().mockResolvedValue(
      ok(makeArchivedRepairResult({ dryRun: true })),
    );

    const runRepair = createRunIssueGroupListingRepair({
      backfillTaskGroupSummarySortKeys,
      repairArchivedOpenPrGroups,
    });
    const result = await runRepair({ dryRun: true });

    expect(result.ok).toBe(true);
    expect(repairArchivedOpenPrGroups).toHaveBeenCalledWith({ dryRun: true });
  });
});
