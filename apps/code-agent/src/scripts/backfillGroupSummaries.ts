/**
 * Legacy entry point retained for operators and old runbooks.
 *
 * It delegates to the lifecycle reconciliation command, inherits every safety
 * gate, and defaults to summary-only dry-run. There is no second writer here.
 */
import { pathToFileURL } from 'node:url';
import {
  runCodeTaskLifecycleBackfillMain,
  type LifecycleBackfillMainInput,
} from './backfillCodeTaskLifecycleTime.js';

export async function runLegacyGroupSummaryBackfillMain(
  input: LifecycleBackfillMainInput,
): Promise<void> {
  const hasExplicitPhase = input.argv.some((arg) => arg.startsWith('--phase='));
  await runCodeTaskLifecycleBackfillMain({
    ...input,
    argv: hasExplicitPhase ? input.argv : [...input.argv, '--phase=summaries'],
  });
}

function isDirectExecution(): boolean {
  const scriptPath = process.argv[1];
  return scriptPath !== undefined && import.meta.url === pathToFileURL(scriptPath).href;
}

/* v8 ignore start -- module-init: direct entry point is unreachable from ESM import tests; exported delegated main is covered @preserve */
if (isDirectExecution()) {
  void runLegacyGroupSummaryBackfillMain({
    argv: process.argv.slice(2),
    env: process.env,
  });
}
/* v8 ignore stop @preserve */
