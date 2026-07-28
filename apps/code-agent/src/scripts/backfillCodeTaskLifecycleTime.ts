import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import type { Firestore as FirestoreType } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { createAppLogger, initWorker } from '@intexuraos/infra-sentry';
import {
  EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
  LifecycleBackfillAuditError,
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
  createFirestore?: (options: {
    projectId: string;
    credentials: { client_email: string; private_key: string };
  }) => FirestoreType;
  runBackfill?: (
    input: LifecycleBackfillOptions & { firestore: FirestoreType; logger: Logger },
  ) => Promise<unknown>;
  logger?: Logger;
}

export interface LifecycleBackfillTelemetry {
  logger: Logger;
  flush: () => Promise<void>;
}

export interface LifecycleBackfillMainInput {
  argv: readonly string[];
  env: Environment;
  deps?: LifecycleBackfillCliDependencies;
  telemetry?: LifecycleBackfillTelemetry;
  writeLine?: (line: string) => void;
  setExitCode?: (code: number) => void;
}

const TASK_COUNT_FIELDS = [
  'scanned', 'changed', 'skipped', 'invalid', 'deleted',
  'statusChangedAtAdded', 'completedAtAdded', 'activeCompletedAtAnomalies',
] as const;

const SUMMARY_COUNT_FIELDS = [
  'scannedSourceTasks', 'scannedCounts', 'rawGroups', 'authoritativeGroups', 'askOnlyGroups',
  'scannedSummaries', 'processed', 'changed', 'unchanged', 'deleted',
  'missingSummaries', 'semanticUpdates', 'askOnlyOrphans', 'unknownOrphans',
  'invalid', 'summariesWithLabels', 'importantSummaries', 'maxGroupSize',
] as const;
const SOURCE_FIELDS = [
  'status_changed', 'completed', 'dispatch_terminal_cause', 'dispatch_terminal',
  'dispatched', 'queued', 'legacy_updated', 'created',
] as const;
const INVALID_REASON_FIELDS = [
  'status_invalid', 'status_changed_at_invalid', 'completed_at_invalid', 'lifecycle_unresolvable',
] as const;

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function sanitizeCursor(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    /^[A-Za-z0-9_.:%-]+$/u.test(value)
  ) return value;
  return undefined;
}

function pickPhaseReport(
  input: unknown,
  countFields: readonly string[],
): Record<string, unknown> | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of countFields) {
    const value = record[field];
    if (isSafeCount(value)) result[field] = value;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'cursor')) {
    const cursor = sanitizeCursor(record['cursor']);
    if (cursor !== undefined) result['cursor'] = cursor;
  }
  if (typeof record['limitReached'] === 'boolean') {
    result['limitReached'] = record['limitReached'];
  }
  return result;
}

function pickCountMap(input: unknown, fields: readonly string[]): Record<string, number> | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  return Object.fromEntries(fields.flatMap((field) => {
    const value = record[field];
    return isSafeCount(value) ? [[field, value]] : [];
  }));
}

function sanitizeSuccessReport(
  report: unknown,
  options: LifecycleBackfillOptions,
): Record<string, unknown> {
  const record = typeof report === 'object' && report !== null
    ? report as Partial<CodeTaskLifecycleBackfillReport>
    : {};
  const tasks = pickPhaseReport(record.tasks, TASK_COUNT_FIELDS);
  const summaries = pickPhaseReport(record.summaries, SUMMARY_COUNT_FIELDS);
  if (tasks !== undefined) {
    const rawTasks = record.tasks as unknown as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rawTasks, 'sources')) {
      tasks['sources'] = pickCountMap(rawTasks['sources'], SOURCE_FIELDS) ?? {};
    }
    if (Object.prototype.hasOwnProperty.call(rawTasks, 'invalidReasons')) {
      tasks['invalidReasons'] = pickCountMap(rawTasks['invalidReasons'], INVALID_REASON_FIELDS) ?? {};
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

function sanitizeAuditReport(report: unknown): Record<string, unknown> {
  if (typeof report !== 'object' || report === null) return {};
  const record = report as Record<string, unknown>;
  const tasks = pickPhaseReport(record['tasks'], TASK_COUNT_FIELDS);
  const summaries = pickPhaseReport(record['summaries'], SUMMARY_COUNT_FIELDS);
  if (tasks !== undefined) {
    const rawTasks = record['tasks'] as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rawTasks, 'sources')) {
      tasks['sources'] = pickCountMap(rawTasks['sources'], SOURCE_FIELDS) ?? {};
    }
    if (Object.prototype.hasOwnProperty.call(rawTasks, 'invalidReasons')) {
      tasks['invalidReasons'] = pickCountMap(rawTasks['invalidReasons'], INVALID_REASON_FIELDS) ?? {};
    }
  }
  return {
    ...(record['projectId'] === EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID && {
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
    }),
    ...((record['mode'] === 'dry-run' || record['mode'] === 'apply') && { mode: record['mode'] }),
    ...((record['phase'] === 'all' || record['phase'] === 'tasks' || record['phase'] === 'summaries') && {
      phase: record['phase'],
    }),
    ...(tasks !== undefined && { tasks }),
    ...(summaries !== undefined && { summaries }),
  };
}

function reportHasAuditFindings(report: Record<string, unknown>): boolean {
  const tasks = report['tasks'];
  const summaries = report['summaries'];
  const taskInvalid = typeof tasks === 'object' && tasks !== null
    ? (tasks as Record<string, unknown>)['invalid']
    : undefined;
  const summaryRecord = typeof summaries === 'object' && summaries !== null
    ? summaries as Record<string, unknown>
    : undefined;
  const summaryInvalid = summaryRecord?.['invalid'];
  const unknownOrphans = summaryRecord?.['unknownOrphans'];
  return (isSafeCount(taskInvalid) && taskInvalid > 0) ||
    (isSafeCount(summaryInvalid) && summaryInvalid > 0) ||
    (isSafeCount(unknownOrphans) && unknownOrphans > 0);
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
    credentials: credentials.credentials,
  });
  const logger = deps.logger ?? createAppLogger({ name: 'code-task-lifecycle-backfill' });
  let report: unknown;
  let primaryError: unknown;
  let primaryFailed = false;
  let terminationError: unknown;
  let terminationFailed = false;
  try {
    report = await (deps.runBackfill ?? runCodeTaskLifecycleBackfill)({
      ...options,
      firestore,
      logger,
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
  const sanitized = sanitizeSuccessReport(report, options);
  if (reportHasAuditFindings(sanitized)) {
    throw new LifecycleBackfillAuditError(sanitized);
  }
  return sanitized;
}

function sanitizedFailure(error: unknown): Record<string, unknown> {
  if (error instanceof LifecycleBackfillAuditError) {
    let report: Record<string, unknown> = {};
    try {
      report = sanitizeAuditReport(error.report);
    } catch {
      report = {};
    }
    return {
      ...report,
      ok: false,
      error: error.code,
    };
  }
  if (error instanceof LifecycleBackfillRunError) {
    const code = TECHNICAL_FAILURE_CODES.has(error.code) ? error.code : 'UNEXPECTED_FAILURE';
    const cursor = sanitizeCursor(error.cursor);
    return {
      ok: false,
      error: code,
      ...(code !== 'UNEXPECTED_FAILURE' && cursor !== undefined && { cursor }),
    };
  }
  if (error instanceof LifecycleBackfillSafetyError) {
    return { ok: false, error: error.code };
  }
  return { ok: false, error: 'UNEXPECTED_FAILURE' };
}

const TECHNICAL_FAILURE_CODES: ReadonlySet<string> = new Set([
  'TASK_SCAN_FAILED',
  'TASK_TRANSACTION_FAILED',
  'SUMMARY_SCAN_FAILED',
  'SUMMARY_TRANSACTION_FAILED',
]);

function technicalFailureCode(error: unknown): string | undefined {
  if (error instanceof LifecycleBackfillSafetyError || error instanceof LifecycleBackfillAuditError) {
    return undefined;
  }
  if (error instanceof LifecycleBackfillRunError && TECHNICAL_FAILURE_CODES.has(error.code)) {
    return error.code;
  }
  return 'UNEXPECTED_FAILURE';
}

export async function runCodeTaskLifecycleBackfillMain(
  input: LifecycleBackfillMainInput,
): Promise<void> {
  const writeLine = input.writeLine ?? ((line: string): void => { process.stdout.write(`${line}\n`); });
  const setExitCode = input.setExitCode ?? ((code: number): void => { process.exitCode = code; });
  const sentryDsn = input.env['INTEXURAOS_SENTRY_DSN'];
  const telemetry = input.telemetry ?? initWorker({
    serviceName: 'code-task-lifecycle-backfill',
    environment: input.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
    ...(sentryDsn !== undefined && { sentryDsn }),
  });
  try {
    const report = await executeCodeTaskLifecycleBackfillCli(input.argv, input.env, {
      ...input.deps,
      logger: telemetry.logger,
    });
    writeLine(JSON.stringify(report));
  } catch (error) {
    const failureCode = technicalFailureCode(error);
    if (failureCode !== undefined) {
      telemetry.logger.error(
        { event: 'code_task_lifecycle_backfill_failed', failureCode },
        'Code task lifecycle backfill failed',
      );
    }
    writeLine(JSON.stringify(sanitizedFailure(error)));
    setExitCode(1);
  } finally {
    await telemetry.flush();
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
