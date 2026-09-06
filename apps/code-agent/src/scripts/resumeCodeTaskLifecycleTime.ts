import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Firestore, type Firestore as FirestoreType } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { initWorker } from '@intexuraos/infra-sentry';
import {
  validateLifecycleBackfillEnvironment,
} from './lib/codeTaskLifecycleBackfill.js';
import {
  parseLifecycleRollbackArgs,
  type LifecycleRollbackOptions,
} from './rollbackCodeTaskLifecycleTime.js';
import {
  productionLifecycleEndpointsFromEnvironment,
  runProductionLifecycleApplyResume,
} from './lib/productionLifecycleOperations.js';

type Environment = Readonly<Record<string, string | undefined>>;
export type LifecycleResumeOptions = LifecycleRollbackOptions;

export function parseLifecycleResumeArgs(argv: readonly string[]): LifecycleResumeOptions {
  return parseLifecycleRollbackArgs(argv);
}

interface ResumeDependencies {
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  createFirestore?: (options: {
    projectId: string;
    credentials: { client_email: string; private_key: string };
  }) => FirestoreType;
  runResume?: (input: {
    firestore: FirestoreType;
    journalPath: string;
    expectedJournalSha256: string;
    expectedReleaseSha: string;
    env: Environment;
  }) => Promise<Record<string, unknown>>;
}

export interface LifecycleResumeMainInput {
  argv: readonly string[];
  env: Environment;
  deps?: ResumeDependencies;
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

async function executeResume(
  options: LifecycleResumeOptions,
  env: Environment,
  deps: ResumeDependencies,
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
    result = await (deps.runResume ?? (async (input): Promise<Record<string, unknown>> => await runProductionLifecycleApplyResume({
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

export async function runCodeTaskLifecycleResumeMain(input: LifecycleResumeMainInput): Promise<void> {
  const writeLine = input.writeLine ?? ((line: string): void => { process.stdout.write(`${line}\n`); });
  const setExitCode = input.setExitCode ?? ((code: number): void => { process.exitCode = code; });
  const telemetry = input.telemetry ?? initWorker({
    serviceName: 'code-task-lifecycle-resume',
    environment: input.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
    ...(input.env['INTEXURAOS_SENTRY_DSN'] !== undefined && {
      sentryDsn: input.env['INTEXURAOS_SENTRY_DSN'],
    }),
  });
  try {
    const options = parseLifecycleResumeArgs(input.argv);
    writeLine(JSON.stringify(await executeResume(options, input.env, input.deps ?? {})));
  } catch (error) {
    const code = stableErrorCode(error);
    telemetry.logger.error(
      { event: 'code_task_lifecycle_resume_failed', failureCode: code },
      'Code task lifecycle resume failed',
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
  void runCodeTaskLifecycleResumeMain({ argv: process.argv.slice(2), env: process.env });
}
/* v8 ignore stop @preserve */
