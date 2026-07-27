import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import type { Firestore as FirestoreType } from '@google-cloud/firestore';
import {
  LifecycleBackfillRunError,
  LifecycleBackfillSafetyError,
  parseLifecycleBackfillArgs,
  runCodeTaskLifecycleBackfill,
  validateLifecycleBackfillEnvironment,
  type CodeTaskLifecycleBackfillReport,
  type LifecycleBackfillOptions,
} from './lib/codeTaskLifecycleBackfill.js';

type Environment = Readonly<Record<string, string | undefined>>;

export interface LifecycleBackfillCliDependencies {
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  createFirestore?: (options: { projectId: string; keyFilename: string }) => FirestoreType;
  runBackfill?: (
    input: LifecycleBackfillOptions & { firestore: FirestoreType },
  ) => Promise<unknown>;
}

export interface LifecycleBackfillMainInput {
  argv: readonly string[];
  env: Environment;
  deps?: LifecycleBackfillCliDependencies;
  writeLine?: (line: string) => void;
  setExitCode?: (code: number) => void;
}

const TASK_REPORT_FIELDS = [
  'scanned', 'changed', 'skipped', 'invalid', 'deleted',
  'statusChangedAtAdded', 'completedAtAdded', 'activeCompletedAtAnomalies',
  'sources', 'invalidReasons', 'cursor', 'limitReached',
] as const;

const SUMMARY_REPORT_FIELDS = [
  'scannedSourceTasks', 'rawGroups', 'authoritativeGroups', 'askOnlyGroups',
  'scannedSummaries', 'processed', 'changed', 'unchanged', 'deleted',
  'missingSummaries', 'semanticUpdates', 'askOnlyOrphans', 'unknownOrphans',
  'invalid', 'summariesWithLabels', 'importantSummaries', 'maxGroupSize',
  'cursor', 'limitReached',
] as const;
const SOURCE_FIELDS = [
  'status_changed', 'completed', 'dispatch_terminal_cause', 'dispatch_terminal',
  'dispatched', 'queued', 'legacy_updated', 'created',
] as const;
const INVALID_REASON_FIELDS = [
  'status_invalid', 'status_changed_at_invalid', 'completed_at_invalid', 'lifecycle_unresolvable',
] as const;

function pickFields(
  input: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  return Object.fromEntries(fields.flatMap((field) =>
    Object.prototype.hasOwnProperty.call(record, field) ? [[field, record[field]]] : [],
  ));
}

function pickCountMap(input: unknown, fields: readonly string[]): Record<string, number> | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  return Object.fromEntries(fields.flatMap((field) => {
    const value = record[field];
    return typeof value === 'number' && Number.isFinite(value) ? [[field, value]] : [];
  }));
}

function sanitizeSuccessReport(
  report: unknown,
  options: LifecycleBackfillOptions,
): Record<string, unknown> {
  const record = typeof report === 'object' && report !== null
    ? report as Partial<CodeTaskLifecycleBackfillReport>
    : {};
  const tasks = pickFields(record.tasks, TASK_REPORT_FIELDS);
  const summaries = pickFields(record.summaries, SUMMARY_REPORT_FIELDS);
  if (tasks !== undefined) {
    if (Object.prototype.hasOwnProperty.call(tasks, 'sources')) {
      tasks['sources'] = pickCountMap(tasks['sources'], SOURCE_FIELDS) ?? {};
    }
    if (Object.prototype.hasOwnProperty.call(tasks, 'invalidReasons')) {
      tasks['invalidReasons'] = pickCountMap(tasks['invalidReasons'], INVALID_REASON_FIELDS) ?? {};
    }
  }
  return {
    ok: true,
    projectId: options.projectId,
    mode: options.mode,
    phase: options.phase,
    ...(tasks !== undefined && { tasks }),
    ...(summaries !== undefined && { summaries }),
  };
}

export async function executeCodeTaskLifecycleBackfillCli(
  argv: readonly string[],
  env: Environment,
  deps: LifecycleBackfillCliDependencies = {},
): Promise<Record<string, unknown>> {
  const options = parseLifecycleBackfillArgs(argv);
  const credentials = await validateLifecycleBackfillEnvironment(
    options,
    env,
    deps.readFile ?? readFile,
  );

  const firestore = (deps.createFirestore ?? ((clientOptions): FirestoreType => new Firestore(clientOptions)))({
    projectId: options.projectId,
    keyFilename: credentials.keyFilename,
  });
  let report: unknown;
  let primaryError: unknown;
  let primaryFailed = false;
  let terminationError: unknown;
  let terminationFailed = false;
  try {
    report = await (deps.runBackfill ?? runCodeTaskLifecycleBackfill)({
      ...options,
      firestore,
    });
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
  } finally {
    try {
      await firestore.terminate();
    } catch (error) {
      terminationFailed = true;
      terminationError = error;
    }
  }
  if (primaryFailed) throw primaryError;
  if (terminationFailed) throw terminationError;
  return sanitizeSuccessReport(report, options);
}

function sanitizedFailure(error: unknown): Record<string, unknown> {
  if (error instanceof LifecycleBackfillRunError) {
    return {
      ok: false,
      error: error.code,
      ...(error.cursor !== undefined && { cursor: error.cursor }),
    };
  }
  if (error instanceof LifecycleBackfillSafetyError) {
    return { ok: false, error: error.code };
  }
  return { ok: false, error: 'UNEXPECTED_FAILURE' };
}

export async function runCodeTaskLifecycleBackfillMain(
  input: LifecycleBackfillMainInput,
): Promise<void> {
  const writeLine = input.writeLine ?? ((line: string): void => { process.stdout.write(`${line}\n`); });
  const setExitCode = input.setExitCode ?? ((code: number): void => { process.exitCode = code; });
  try {
    const report = await executeCodeTaskLifecycleBackfillCli(input.argv, input.env, input.deps);
    writeLine(JSON.stringify(report));
  } catch (error) {
    writeLine(JSON.stringify(sanitizedFailure(error)));
    setExitCode(1);
  }
}

function isDirectExecution(): boolean {
  const scriptPath = process.argv[1];
  return scriptPath !== undefined && import.meta.url === pathToFileURL(scriptPath).href;
}

/* v8 ignore start -- module-init: direct entry point is unreachable from ESM import tests; exported main is covered @preserve */
if (isDirectExecution()) {
  void runCodeTaskLifecycleBackfillMain({
    argv: process.argv.slice(2),
    env: process.env,
  });
}
/* v8 ignore stop @preserve */
