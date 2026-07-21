import { createHmac } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  IntexAgentServiceClient,
  MatrixCorpusClientResult,
  WhatsAppServiceClient,
} from '@intexuraos/internal-clients';

import {
  selectMatrixCorpusRetention,
  type MatrixCorpusArtifactPort,
  type MatrixCorpusRetentionRecord,
} from './reportArtifacts.js';

const MAX_CLEANUP_CHUNKS = 10_000;
const TRANSIENT_RETRY_LIMIT = 3;
const RETENTION_SAGA_VERSION = 1;
const MAX_RETENTION_SAGAS = 4;

export interface MatrixCorpusRetentionSaga {
  readonly version: 1;
  readonly targetRunId: string;
  readonly targetLeaseFence: string;
  readonly targetRunFenceDigest: string;
  readonly stage:
    | 'whatsapp_pending'
    | 'whatsapp_request_in_flight'
    | 'whatsapp_cleaned'
    | 'intex_request_in_flight'
    | 'intex_cleaned';
  readonly whatsappRevision: number;
}

export interface MatrixCorpusRetentionSagaPort {
  load(): Promise<{ ok: true; sagas: readonly MatrixCorpusRetentionSaga[] } | { ok: false }>;
  save(saga: MatrixCorpusRetentionSaga): Promise<boolean>;
  remove(targetRunId: string): Promise<boolean>;
}

export interface MatrixCorpusCleanupCounts {
  observation: 'complete' | 'removals_only' | 'not_observed';
  considered: number;
  retained: number;
  removed: number;
  missing: number;
  failed: number;
}

export interface MatrixCorpusRetentionStats {
  status: 'passed' | 'failed';
  runs: MatrixCorpusCleanupCounts;
  sessions: MatrixCorpusCleanupCounts;
  capabilities: MatrixCorpusCleanupCounts;
  artifacts: MatrixCorpusCleanupCounts;
}

type RetentionIntexClient = Pick<
  IntexAgentServiceClient,
  'getMatrixCorpusRetentionPlan' | 'cleanupMatrixCorpusRun'
>;
type RetentionWhatsAppClient = Pick<WhatsAppServiceClient, 'cleanupMatrixCorpusRun'>;

export async function reconcileMatrixCorpusRetention(input: {
  readonly runId: string;
  readonly userId: string;
  readonly leaseFence: string;
  readonly currentRevision: number;
  readonly bindingHmacKey: string;
  readonly artifactRoot: string;
  readonly files: Pick<MatrixCorpusArtifactPort, 'removeExactPrivateDirectory'>;
  readonly sagas: MatrixCorpusRetentionSagaPort;
  readonly intex: RetentionIntexClient;
  readonly whatsapp: RetentionWhatsAppClient;
  readonly now: () => Date;
}): Promise<
  | { readonly ok: true; readonly revision: number; readonly stats: MatrixCorpusRetentionStats }
  | {
      readonly ok: false;
      readonly code: 'retention_cleanup_failed';
      readonly stats: MatrixCorpusRetentionStats;
    }
> {
  const failed = (
    stats: MatrixCorpusRetentionStats
  ): { ok: false; code: 'retention_cleanup_failed'; stats: MatrixCorpusRetentionStats } => {
    stats.status = 'failed';
    return { ok: false as const, code: 'retention_cleanup_failed' as const, stats };
  };
  const plan = await withTransientRetries(() =>
    input.intex.getMatrixCorpusRetentionPlan({
      runId: input.runId,
      userId: input.userId,
      leaseFence: input.leaseFence,
    })
  );
  const emptyStats = retentionStats(0, 0);
  if (Buffer.byteLength(input.bindingHmacKey, 'utf8') < 32) return failed(emptyStats);
  if (!plan.ok) return failed(emptyStats);

  const records: readonly MatrixCorpusRetentionRecord[] = plan.value.records;
  const selection = selectMatrixCorpusRetention(records);
  const loadedSagas = await input.sagas.load();
  const stats = retentionStats(records.length, selection.retainRunIds.length);
  if (!loadedSagas.ok) return failed(stats);
  const targets = new Map<string, MatrixCorpusRetentionRecord>();
  for (const saga of loadedSagas.sagas) {
    const fromPlan = records.find((record) => record.runId === saga.targetRunId);
    targets.set(saga.targetRunId, fromPlan ?? sagaRecord(saga));
  }
  for (const target of selection.evict) targets.set(target.runId, target);
  if (targets.size > 1 || selection.evict.length > 1) {
    stats.runs.failed = targets.size;
    stats.artifacts.failed = targets.size;
    return failed(stats);
  }

  let revision = input.currentRevision;
  for (const target of targets.values()) {
    const targetRunFenceDigest = matrixCorpusKeyedDigest(input.bindingHmacKey, 'imc-run-fence-v1', [
      'home-dev',
      input.userId,
      target.runId,
    ]);
    const persisted = loadedSagas.sagas.find((saga) => saga.targetRunId === target.runId);
    if (
      persisted !== undefined &&
      (persisted.targetLeaseFence !== target.leaseFence ||
        persisted.targetRunFenceDigest !== targetRunFenceDigest)
    )
      return failed(stats);
    let saga: MatrixCorpusRetentionSaga = persisted ?? {
      version: RETENTION_SAGA_VERSION,
      targetRunId: target.runId,
      targetLeaseFence: target.leaseFence,
      targetRunFenceDigest,
      stage: 'whatsapp_pending',
      whatsappRevision: 0,
    };
    if (persisted === undefined && !(await input.sagas.save(saga))) return failed(stats);

    let whatsappCleaned = saga.stage === 'whatsapp_cleaned' || saga.stage.startsWith('intex_');
    for (let chunk = 0; !whatsappCleaned && chunk < MAX_CLEANUP_CHUNKS; chunk += 1) {
      const inFlight: MatrixCorpusRetentionSaga = {
        ...saga,
        stage: 'whatsapp_request_in_flight',
      };
      if (!(await input.sagas.save(inFlight))) return failed(stats);
      saga = inFlight;
      const cleanup = await withTransientRetries(() =>
        input.whatsapp.cleanupMatrixCorpusRun({
          runId: input.runId,
          leaseFence: input.leaseFence,
          idempotencyKey: operationKey(
            input.runId,
            `retention:${target.runId}:${String(saga.whatsappRevision)}`
          ),
          targetRunId: target.runId,
          targetLeaseFence: target.leaseFence,
          targetRunFenceDigest,
          expectedRevision: saga.whatsappRevision,
        })
      );
      if (!cleanup.ok) {
        if (cleanup.error.httpStatus === 404 && saga.stage === 'whatsapp_request_in_flight') {
          saga = { ...saga, stage: 'whatsapp_cleaned' };
          if (!(await input.sagas.save(saga))) return failed(stats);
          whatsappCleaned = true;
          break;
        }
        return failed(stats);
      }
      if (cleanup.value.state === 'cleaned') {
        if (cleanup.value.finalRevision !== saga.whatsappRevision + 1) {
          return failed(stats);
        }
        saga = {
          ...saga,
          stage: 'whatsapp_cleaned',
          whatsappRevision: cleanup.value.finalRevision,
        };
        if (!(await input.sagas.save(saga))) return failed(stats);
        whatsappCleaned = true;
        break;
      }
      if (
        cleanup.value.committedRevision !== saga.whatsappRevision + 1 ||
        cleanup.value.remainingChildCount < 1
      ) {
        return failed(stats);
      }
      saga = {
        ...saga,
        stage: 'whatsapp_pending',
        whatsappRevision: cleanup.value.committedRevision,
      };
      if (!(await input.sagas.save(saga))) return failed(stats);
    }
    if (!whatsappCleaned) {
      return failed(stats);
    }

    if (saga.stage !== 'intex_cleaned') {
      saga = { ...saga, stage: 'intex_request_in_flight' };
      if (!(await input.sagas.save(saga))) return failed(stats);
    }
    const intexCleanup =
      saga.stage === 'intex_cleaned'
        ? null
        : await withTransientRetries(() =>
            input.intex.cleanupMatrixCorpusRun({
              runId: input.runId,
              userId: input.userId,
              leaseFence: input.leaseFence,
              request: {
                targetRunId: target.runId,
                targetLeaseFence: target.leaseFence,
                updatedAt: input.now().toISOString(),
              },
            })
          );
    if (intexCleanup !== null && !intexCleanup.ok) {
      const absentFromPlan = !records.some((record) => record.runId === target.runId);
      if (intexCleanup.error.httpStatus !== 404 || !absentFromPlan) return failed(stats);
    }
    if (intexCleanup?.ok === true) {
      revision = intexCleanup.value.currentRevision;
      stats.sessions.removed += intexCleanup.value.removed.sessions;
    }
    saga = { ...saga, stage: 'intex_cleaned' };
    if (!(await input.sagas.save(saga))) return failed(stats);

    const artifact = await removeArtifactWithRetries(
      input.files,
      join(input.artifactRoot, target.runId)
    );
    const stagingArtifact = await removeArtifactWithRetries(
      input.files,
      join(input.artifactRoot, `.${target.runId}.staging`)
    );
    if (artifact === 'failed' || stagingArtifact === 'failed') {
      stats.artifacts.failed += 1;
      return failed(stats);
    }
    if (artifact === 'missing' && stagingArtifact === 'missing') stats.artifacts.missing += 1;
    else stats.artifacts.removed += 1;
    if (!(await input.sagas.remove(target.runId))) return failed(stats);
    stats.runs.removed += 1;
  }

  return { ok: true, revision, stats };
}

export function createNodeMatrixCorpusRetentionSagaPort(
  artifactRoot: string
): MatrixCorpusRetentionSagaPort {
  const directory = join(artifactRoot, '.retention-sagas');
  const fileFor = (targetRunId: string): string => join(directory, `${targetRunId}.json`);
  const readyDirectory = async (): Promise<boolean> => {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const metadata = await lstat(directory);
      return (
        metadata.isDirectory() &&
        !metadata.isSymbolicLink() &&
        (metadata.mode & 0o7777) === 0o700 &&
        metadata.uid === process.getuid?.()
      );
    } catch {
      return false;
    }
  };
  return {
    async load(): ReturnType<MatrixCorpusRetentionSagaPort['load']> {
      if (!(await readyDirectory())) return { ok: false };
      try {
        const names = (await readdir(directory)).filter((name) => name.endsWith('.json'));
        if (names.length > MAX_RETENTION_SAGAS) return { ok: false };
        const sagas: MatrixCorpusRetentionSaga[] = [];
        for (const name of names.sort()) {
          const path = join(directory, name);
          const metadata = await lstat(path);
          if (
            !metadata.isFile() ||
            metadata.isSymbolicLink() ||
            metadata.size > 4_096 ||
            (metadata.mode & 0o7777) !== 0o600 ||
            metadata.uid !== process.getuid?.()
          )
            return { ok: false };
          const parsed = parseSaga(JSON.parse(await readFile(path, 'utf8')));
          if (parsed === null || name !== `${parsed.targetRunId}.json`) return { ok: false };
          sagas.push(parsed);
        }
        return { ok: true, sagas };
      } catch {
        return { ok: false };
      }
    },
    async save(saga): ReturnType<MatrixCorpusRetentionSagaPort['save']> {
      const parsed = parseSaga(saga);
      if (parsed === null || !(await readyDirectory())) return false;
      const destination = fileFor(parsed.targetRunId);
      const candidate = `${destination}.candidate`;
      await rm(candidate, { force: true }).catch(() => undefined);
      try {
        const handle = await open(
          candidate,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600
        );
        try {
          await handle.writeFile(`${JSON.stringify(parsed)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(candidate, destination);
        return true;
      } catch {
        await rm(candidate, { force: true }).catch(() => undefined);
        return false;
      }
    },
    async remove(targetRunId): ReturnType<MatrixCorpusRetentionSagaPort['remove']> {
      if (!isSafeRunId(targetRunId) || !(await readyDirectory())) return false;
      try {
        const path = fileFor(targetRunId);
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
        await rm(path, { force: false });
        return true;
      } catch (error) {
        return isMissing(error);
      }
    },
  };
}

function parseSaga(value: unknown): MatrixCorpusRetentionSaga | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const stages = new Set<MatrixCorpusRetentionSaga['stage']>([
    'whatsapp_pending',
    'whatsapp_request_in_flight',
    'whatsapp_cleaned',
    'intex_request_in_flight',
    'intex_cleaned',
  ]);
  if (
    Object.keys(record).sort().join(',') !==
      'stage,targetLeaseFence,targetRunFenceDigest,targetRunId,version,whatsappRevision' ||
    record['version'] !== RETENTION_SAGA_VERSION ||
    !isSafeRunId(record['targetRunId']) ||
    typeof record['targetLeaseFence'] !== 'string' ||
    !/^[1-9][0-9]{0,19}$/u.test(record['targetLeaseFence']) ||
    typeof record['targetRunFenceDigest'] !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(record['targetRunFenceDigest']) ||
    typeof record['stage'] !== 'string' ||
    !stages.has(record['stage'] as MatrixCorpusRetentionSaga['stage']) ||
    !Number.isSafeInteger(record['whatsappRevision']) ||
    (record['whatsappRevision'] as number) < 0 ||
    (record['whatsappRevision'] as number) > 64
  )
    return null;
  return record as unknown as MatrixCorpusRetentionSaga;
}

function sagaRecord(saga: MatrixCorpusRetentionSaga): MatrixCorpusRetentionRecord {
  return {
    runId: saga.targetRunId,
    leaseFence: saga.targetLeaseFence,
    startedAt: '1970-01-01T00:00:00.000Z',
    lifecycle: 'stopped',
    verdict: 'not_evaluated',
    artifactDelivery: 'unknown',
    completedAt: '1970-01-01T00:00:00.000Z',
    isCurrent: false,
  };
}

function isSafeRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function matrixCorpusKeyedDigest(
  key: string,
  domain: string,
  parts: readonly string[]
): string {
  const hmac = createHmac('sha256', key);
  hmac.update(domain, 'utf8');
  hmac.update(Buffer.from([0]));
  for (const part of parts) {
    const bytes = Buffer.from(part, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hmac.update(length);
    hmac.update(bytes);
  }
  return hmac.digest('hex');
}

function retentionStats(considered: number, retained: number): MatrixCorpusRetentionStats {
  const counts = (
    observation: MatrixCorpusCleanupCounts['observation'],
    includeInventory: boolean
  ): MatrixCorpusCleanupCounts => ({
    observation,
    considered: includeInventory ? considered : 0,
    retained: includeInventory ? retained : 0,
    removed: 0,
    missing: 0,
    failed: 0,
  });
  return {
    status: 'passed',
    runs: counts('complete', true),
    sessions: counts('removals_only', false),
    capabilities: counts('not_observed', false),
    artifacts: counts('complete', true),
  };
}

async function withTransientRetries<T>(
  operation: () => Promise<MatrixCorpusClientResult<T>>
): Promise<MatrixCorpusClientResult<T>> {
  let result = await operation();
  for (
    let attempt = 1;
    !result.ok &&
    (result.error.code === 'timeout' || result.error.code === 'unavailable') &&
    attempt < TRANSIENT_RETRY_LIMIT;
    attempt += 1
  ) {
    result = await operation();
  }
  return result;
}

async function removeArtifactWithRetries(
  files: Pick<MatrixCorpusArtifactPort, 'removeExactPrivateDirectory'>,
  path: string
): Promise<'removed' | 'missing' | 'failed'> {
  let result = await files.removeExactPrivateDirectory(path);
  for (let attempt = 1; result === 'failed' && attempt < TRANSIENT_RETRY_LIMIT; attempt += 1) {
    result = await files.removeExactPrivateDirectory(path);
  }
  return result;
}

function operationKey(runId: string, operation: string): string {
  return `${runId}:${operation}`.slice(0, 128);
}
