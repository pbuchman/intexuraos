import { isAbsolute } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Firestore, type Firestore as FirestoreType } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { initWorker } from '@intexuraos/infra-sentry';
import {
  EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
  LifecycleBackfillSafetyError,
  validateLifecycleBackfillEnvironment,
} from './lib/codeTaskLifecycleBackfill.js';
import {
  productionLifecycleEndpointsFromEnvironment,
  runProductionLifecycleRollback,
} from './lib/productionLifecycleOperations.js';

type Environment = Readonly<Record<string, string | undefined>>;
const EXACT_SHA = /^[0-9a-f]{40}$/u;
const EXACT_JOURNAL_SHA = /^[0-9a-f]{64}$/u;

export interface LifecycleRollbackOptions {
  projectId: string;
  journalPath: string;
  journalSha256: string;
  expectedReleaseSha: string;
}

export function parseLifecycleRollbackArgs(argv: readonly string[]): LifecycleRollbackOptions {
  const values = new Map<string, string>();
  for (const arg of argv) {
    const at = arg.indexOf('=');
    if (at <= 0) throw new LifecycleBackfillSafetyError('ROLLBACK_FLAG_INVALID');
    const name = arg.slice(0, at);
    const value = arg.slice(at + 1);
    if (!['--project', '--journal', '--journal-sha', '--expected-release-sha'].includes(name)) {
      throw new LifecycleBackfillSafetyError('UNKNOWN_FLAG');
    }
    if (values.has(name)) throw new LifecycleBackfillSafetyError('DUPLICATE_FLAG');
    values.set(name, value);
  }
  const projectId = values.get('--project');
  const journalPath = values.get('--journal');
  const journalSha256 = values.get('--journal-sha');
  const expectedReleaseSha = values.get('--expected-release-sha');
  if (projectId !== EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID) {
    throw new LifecycleBackfillSafetyError('PROJECT_MISMATCH');
  }
  if (journalPath === undefined || !isAbsolute(journalPath)) {
    throw new LifecycleBackfillSafetyError('JOURNAL_PATH_INVALID');
  }
  if (journalSha256 === undefined || !EXACT_JOURNAL_SHA.test(journalSha256)) {
    throw new LifecycleBackfillSafetyError('JOURNAL_SHA_INVALID');
  }
  if (expectedReleaseSha === undefined || !EXACT_SHA.test(expectedReleaseSha)) {
    throw new LifecycleBackfillSafetyError('EXPECTED_RELEASE_SHA_INVALID');
  }
  return { projectId, journalPath, journalSha256, expectedReleaseSha };
}

interface RollbackDependencies {
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  createFirestore?: (options: {
    projectId: string;
    credentials: { client_email: string; private_key: string };
  }) => FirestoreType;
  runRollback?: (input: {
    firestore: FirestoreType;
    journalPath: string;
    expectedJournalSha256: string;
    expectedReleaseSha: string;
    env: Environment;
  }) => Promise<Record<string, unknown>>;
}

export interface LifecycleRollbackMainInput {
  argv: readonly string[];
  env: Environment;
  deps?: RollbackDependencies;
  telemetry?: { logger: Logger; flush: () => Promise<void> };
  writeLine?: (line: string) => void;
  setExitCode?: (code: number) => void;
}

function stableErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(code)) return code;
  }
  return 'UNEXPECTED_FAILURE';
}

async function executeRollback(
  options: LifecycleRollbackOptions,
  env: Environment,
  deps: RollbackDependencies,
): Promise<Record<string, unknown>> {
  const credentials = await validateLifecycleBackfillEnvironment(
    { projectId: options.projectId, mode: 'apply', expectedReleaseSha: options.expectedReleaseSha },
    env,
    deps.readFile ?? readFile,
  );
  const firestore = (deps.createFirestore ?? ((clientOptions): FirestoreType => new Firestore(clientOptions)))({
    projectId: options.projectId,
    credentials: credentials.credentials,
  });
  let result: Record<string, unknown> | undefined;
  let primaryError: unknown;
  try {
    result = await (deps.runRollback ?? (async (input): Promise<Record<string, unknown>> => await runProductionLifecycleRollback({
      firestore: input.firestore,
      journalPath: input.journalPath,
      expectedJournalSha256: input.expectedJournalSha256,
      expectedReleaseSha: input.expectedReleaseSha,
      endpoints: productionLifecycleEndpointsFromEnvironment(input.env),
    })))({
      firestore,
      journalPath: options.journalPath,
      expectedJournalSha256: options.journalSha256,
      expectedReleaseSha: options.expectedReleaseSha,
      env,
    });
  } catch (error) {
    primaryError = error;
  }
  try {
    await firestore.terminate();
  } catch (error) {
    if (primaryError === undefined) primaryError = error;
  }
  if (primaryError !== undefined) {
    throw primaryError instanceof Error
      ? primaryError
      : new Error('Non-Error value thrown', { cause: primaryError });
  }
  return result ?? { ok: true };
}

export async function runCodeTaskLifecycleRollbackMain(
  input: LifecycleRollbackMainInput,
): Promise<void> {
  const writeLine = input.writeLine ?? ((line: string): void => { process.stdout.write(`${line}\n`); });
  const setExitCode = input.setExitCode ?? ((code: number): void => { process.exitCode = code; });
  const telemetry = input.telemetry ?? initWorker({
    serviceName: 'code-task-lifecycle-rollback',
    environment: input.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
    ...(input.env['INTEXURAOS_SENTRY_DSN'] !== undefined && {
      sentryDsn: input.env['INTEXURAOS_SENTRY_DSN'],
    }),
  });
  try {
    const options = parseLifecycleRollbackArgs(input.argv);
    const result = await executeRollback(options, input.env, input.deps ?? {});
    writeLine(JSON.stringify(result));
  } catch (error) {
    const code = stableErrorCode(error);
    telemetry.logger.error(
      { event: 'code_task_lifecycle_rollback_failed', failureCode: code },
      'Code task lifecycle rollback failed',
    );
    writeLine(JSON.stringify({ ok: false, error: code }));
    setExitCode(1);
  } finally {
    await telemetry.flush();
  }
}

function isDirectExecution(): boolean {
  const scriptPath = process.argv[1];
  return scriptPath !== undefined && import.meta.url === pathToFileURL(scriptPath).href;
}

/* v8 ignore start -- module-init: direct entry point is covered through exported main @preserve */
if (isDirectExecution()) {
  void runCodeTaskLifecycleRollbackMain({ argv: process.argv.slice(2), env: process.env });
}
/* v8 ignore stop @preserve */
