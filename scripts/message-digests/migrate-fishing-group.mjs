#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  parseFishingMigrationArgs,
  readProtectedFishingBinding,
  runFishingMigrationActivate,
  runFishingMigrationApply,
  runFishingMigrationCompensate,
  runFishingMigrationDryRun,
  runFishingMigrationVerify,
} from './fishing-group-migration.mjs';
import {
  createFishingMigrationAggregator,
  createFishingMigrationFirestorePorts,
  createFishingMigrationSourcePort,
} from './fishing-group-production-ports.mjs';

const DEFAULT_OPERATIONS = Object.freeze({
  dryRun: runFishingMigrationDryRun,
  apply: runFishingMigrationApply,
  verify: runFishingMigrationVerify,
  activate: runFishingMigrationActivate,
  compensate: runFishingMigrationCompensate,
});
const OPERATION_BY_MODE = Object.freeze({
  'dry-run': 'dryRun',
  apply: 'apply',
  verify: 'verify',
  activate: 'activate',
  compensate: 'compensate',
});
const SAFE_REPORT_KEYS = [
  'counts',
  'cutoverDate',
  'hashes',
  'migrationId',
  'mode',
  'replayEndDate',
  'replayStartDate',
  'status',
];

export async function runFishingMigrationCli(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const now = options.now ?? (() => new Date().toISOString());
  const stdout = options.stdout ?? ((value) => process.stdout.write(value));
  const stderr = options.stderr ?? ((value) => process.stderr.write(value));
  const createPorts = options.createPorts ?? createProductionFishingMigrationPorts;
  const operations = options.operations ?? DEFAULT_OPERATIONS;
  let session = null;
  let closed = false;

  try {
    const parsed = parseFishingMigrationArgs(argv);
    const binding = readProtectedFishingBinding(environment);
    const operational = readOperationalConfig(environment, parsed.mode);
    session = await createPorts({
      mode: parsed.mode,
      projectId: binding.projectId,
      ...operational,
    });
    if (!isRecord(session) || !isRecord(session.ports)) {
      throw safeError('MIGRATION_PORTS_INVALID');
    }
    const operationName = OPERATION_BY_MODE[parsed.mode];
    const operation = operations[operationName];
    if (typeof operation !== 'function') throw safeError('MIGRATION_PORTS_INVALID');
    const result = await operation(
      {
        migrationId: parsed.migrationId,
        binding,
        now: now(),
        ...(parsed.cutoverDeadline === null ? {} : { cutoverDeadline: parsed.cutoverDeadline }),
      },
      session.ports
    );
    const report = assertSafeReport(result?.report, parsed);
    if (typeof session.close === 'function') {
      await session.close();
      closed = true;
    }
    stdout(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    if (!closed && typeof session?.close === 'function') {
      try {
        await session.close();
      } catch {
        // Cleanup failure remains content-free and cannot replace the original safe code.
      }
    }
    stderr(`${JSON.stringify({ ok: false, code: safeErrorCode(error) })}\n`);
    return 1;
  }
}

export async function createProductionFishingMigrationPorts(config) {
  const { applicationDefault, deleteApp, getApp, getApps, initializeApp } =
    await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const appName = `message-digest-migration-${createHash('sha256')
    .update(config.projectId, 'utf8')
    .digest('hex')
    .slice(0, 16)}`;
  const existing = getApps().some((candidate) => candidate.name === appName);
  const app = existing
    ? getApp(appName)
    : initializeApp({ credential: applicationDefault(), projectId: config.projectId }, appName);
  const source = createFishingMigrationSourcePort({
    baseUrl: config.whatsappServiceUrl,
    internalAuthToken: config.internalAuthToken,
  });
  const firestorePorts = createFishingMigrationFirestorePorts({
    firestore: getFirestore(app),
    getDeliveryState: source.getDeliveryState,
  });
  const ports = { ...firestorePorts, source };
  if (config.mode === 'apply') {
    ports.aggregateDay = createFishingMigrationAggregator({
      apiKey: config.openRouterApiKey,
      model: config.digestLlmModel,
      usageServiceUrl: config.llmUsageServiceUrl,
      internalAuthToken: config.internalAuthToken,
      environment: config.environment,
    });
  }
  return {
    ports,
    close: existing ? async () => undefined : async () => await deleteApp(app),
  };
}

function readOperationalConfig(environment, mode) {
  const nodeEnvironment = environment['NODE_ENV'];
  const runtimeEnvironment =
    nodeEnvironment === 'production' ? 'prod' : nodeEnvironment === 'test' ? 'test' : 'dev';
  const whatsappServiceUrl = operationalValue(environment, 'INTEXURAOS_WHATSAPP_SERVICE_URL');
  const internalAuthToken = operationalValue(environment, 'INTEXURAOS_INTERNAL_AUTH_TOKEN');
  if (mode !== 'apply') {
    return { whatsappServiceUrl, internalAuthToken, environment: runtimeEnvironment };
  }
  return {
    whatsappServiceUrl,
    internalAuthToken,
    openRouterApiKey: operationalValue(environment, 'INTEXURAOS_OPENROUTER_APP_API_KEY'),
    digestLlmModel: operationalValue(environment, 'INTEXURAOS_DIGEST_LLM_MODEL'),
    llmUsageServiceUrl: operationalValue(environment, 'INTEXURAOS_LLM_USAGE_SERVICE_URL'),
    environment: runtimeEnvironment,
  };
}

function operationalValue(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim() === '' || value.length > 8_192) {
    throw safeError('MIGRATION_OPERATIONAL_CONFIG_INVALID');
  }
  return value.trim();
}

function assertSafeReport(value, parsed) {
  if (
    !isRecord(value) ||
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .join(',') !== SAFE_REPORT_KEYS.join(',') ||
    value.mode !== parsed.mode ||
    value.migrationId !== parsed.migrationId ||
    typeof value.status !== 'string' ||
    !/^[a-z][a-z0-9_]{1,63}$/u.test(value.status) ||
    !isDate(value.cutoverDate) ||
    !isDate(value.replayStartDate) ||
    !isDate(value.replayEndDate) ||
    !isSafeCounts(value.counts) ||
    !isSafeHashes(value.hashes)
  ) {
    throw safeError('MIGRATION_REPORT_INVALID');
  }
  return value;
}

function isSafeCounts(value) {
  if (!isRecord(value) || Object.keys(value).length > 64) return false;
  return Object.entries(value).every(
    ([key, count]) =>
      /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key) && Number.isInteger(count) && count >= 0
  );
}

function isSafeHashes(value) {
  if (!isRecord(value) || Object.keys(value).length > 32) return false;
  return Object.entries(value).every(
    ([key, hash]) =>
      /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key) &&
      typeof hash === 'string' &&
      /^[0-9a-f]{64}$/u.test(hash)
  );
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function safeErrorCode(error) {
  const candidate =
    isRecord(error) && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message
        : '';
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate) ? candidate : 'MIGRATION_EXECUTION_FAILED';
}

function safeError(code) {
  return new Error(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entryPath !== null && entryPath === fileURLToPath(import.meta.url)) {
  const exitCode = await runFishingMigrationCli();
  process.exitCode = exitCode;
}
