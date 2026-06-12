/**
 * Repair archived task groups that still belong to open PRs.
 *
 * Usage:
 *   npx tsx apps/code-agent/src/scripts/repairArchivedOpenPrGroups.ts
 *   npx tsx apps/code-agent/src/scripts/repairArchivedOpenPrGroups.ts --dry-run
 *   npx tsx apps/code-agent/src/scripts/repairArchivedOpenPrGroups.ts --scan-limit=100
 */

import { Firestore } from '@google-cloud/firestore';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { setFirestore } from '@intexuraos/infra-firestore';
import { createFirestoreCodeTaskRepository } from '../infra/firestore/firestoreCodeTaskRepository.js';
import { createFirestoreGitHubPRSummariesRepository } from '../infra/firestore/gitHubPRSummariesRepository.js';
import { createTaskGroupSummaryFirestoreRepository } from '../infra/firestore/taskGroupSummaryFirestoreRepository.js';
import {
  createRepairArchivedOpenPrGroupsUseCase,
  formatRepairArchivedOpenPrGroupsError,
  type RepairArchivedOpenPrGroupsDeps,
} from '../domain/usecases/repairArchivedOpenPrGroups.js';
/* v8 ignore start -- module-init: standalone repair script is never imported by test suites; cannot be unit-tested without a live Firestore connection @preserve */

function parseDryRun(argv: string[]): boolean {
  return argv.includes('--dry-run');
}

function parseScanLimit(argv: string[]): number | undefined {
  const flag = argv.find((arg) => arg.startsWith('--scan-limit='));
  if (flag === undefined) {
    return undefined;
  }

  const raw = flag.slice('--scan-limit='.length);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --scan-limit value: ${raw}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = parseDryRun(argv);
  const scanLimit = parseScanLimit(argv);

  const logger = createAppLogger({ name: 'repair-archived-open-pr-groups' });
  const firestore = new Firestore();
  setFirestore(firestore);

  const codeTaskRepo = createFirestoreCodeTaskRepository({ firestore, logger });
  const gitHubPRSummaryRepo = createFirestoreGitHubPRSummariesRepository({ logger });
  const groupSummaryRepo = createTaskGroupSummaryFirestoreRepository({ firestore, logger });
  const useCase = createRepairArchivedOpenPrGroupsUseCase({
    codeTaskRepo: codeTaskRepo as unknown as RepairArchivedOpenPrGroupsDeps['codeTaskRepo'],
    gitHubPRSummaryRepo,
    groupSummaryRepo,
    logger,
  });

  const result = await useCase({
    dryRun,
    ...(scanLimit !== undefined ? { scanLimit } : {}),
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${formatRepairArchivedOpenPrGroupsError(error)}\n`);
  process.exit(1);
});

/* v8 ignore stop @preserve */
