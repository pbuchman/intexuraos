import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  RepairArchivedOpenPrGroupsInput,
  RepairArchivedOpenPrGroupsResult,
} from '../../domain/usecases/repairArchivedOpenPrGroups.js';
import type { TaskGroupSummarySortKeyBackfillResult } from './backfillTaskGroupSummarySortKeys.js';
export type { TaskGroupSummarySortKeyBackfillResult } from './backfillTaskGroupSummarySortKeys.js';

export interface RunIssueGroupListingRepairDeps {
  backfillTaskGroupSummarySortKeys(
    input?: { dryRun?: boolean },
  ): Promise<Result<TaskGroupSummarySortKeyBackfillResult>>;
  repairArchivedOpenPrGroups(
    input?: RepairArchivedOpenPrGroupsInput,
  ): Promise<Result<RepairArchivedOpenPrGroupsResult>>;
}

export interface RunIssueGroupListingRepairInput extends RepairArchivedOpenPrGroupsInput {
  dryRun?: boolean;
}

export interface RunIssueGroupListingRepairResult {
  dryRun: boolean;
  sortKeyBackfill: TaskGroupSummarySortKeyBackfillResult;
  archivedOpenPrRepair: RepairArchivedOpenPrGroupsResult;
}

export function createRunIssueGroupListingRepair(
  deps: RunIssueGroupListingRepairDeps,
): (
  input?: RunIssueGroupListingRepairInput
) => Promise<Result<RunIssueGroupListingRepairResult>> {
  return async (input?: RunIssueGroupListingRepairInput): Promise<Result<RunIssueGroupListingRepairResult>> => {
    const dryRun = input?.dryRun === true;

    const backfillResult = await deps.backfillTaskGroupSummarySortKeys({ dryRun });
    if (!backfillResult.ok) {
      return err(new Error(backfillResult.error.message));
    }

    const repairInput: RepairArchivedOpenPrGroupsInput = {
      dryRun,
      ...(input?.scanLimit !== undefined ? { scanLimit: input.scanLimit } : {}),
    };
    const archivedOpenPrRepairResult = await deps.repairArchivedOpenPrGroups(repairInput);
    if (!archivedOpenPrRepairResult.ok) {
      return err(new Error(archivedOpenPrRepairResult.error.message));
    }

    return ok({
      dryRun,
      sortKeyBackfill: backfillResult.value,
      archivedOpenPrRepair: archivedOpenPrRepairResult.value,
    });
  };
}
