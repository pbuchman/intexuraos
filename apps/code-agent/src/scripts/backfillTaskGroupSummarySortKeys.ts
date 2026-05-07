/**
 * Idempotent backfill for task_group_summaries Linear issue sort-key fields.
 *
 * Usage:
 *   npx tsx apps/code-agent/src/scripts/backfillTaskGroupSummarySortKeys.ts
 *   npx tsx apps/code-agent/src/scripts/backfillTaskGroupSummarySortKeys.ts --dry-run
 *
 * Default mode applies updates. Use --dry-run to inspect without writing.
 */

import { Firestore } from '@google-cloud/firestore';
import { runTaskGroupSummarySortKeyBackfill } from './lib/backfillTaskGroupSummarySortKeys.js';
/* v8 ignore start -- module-init: standalone backfill script is never imported by test suites; cannot be unit-tested without a live Firestore connection @preserve */

function parseDryRun(argv: string[]): boolean {
  return argv.includes('--dry-run');
}

async function main(): Promise<void> {
  const dryRun = parseDryRun(process.argv.slice(2));
  const db = new Firestore();
  const result = await runTaskGroupSummarySortKeyBackfill({
    firestore: db,
    dryRun,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

/* v8 ignore stop @preserve */
