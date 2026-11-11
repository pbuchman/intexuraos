#!/usr/bin/env -S pnpm exec tsx
/** Read-only loopback monitoring sampler. Token files contain only the raw token.
 * Outputs allowlisted aggregate JSONL, never response bodies, IDs or raw errors.
 * Protobuf bytes measure encoded messages, not network framing or billing.
 * receivedDocuments/documentReads count documentChange bodies. Remove/delete
 * events have separate counters and are not added to document counts/bytes.
 */
import { constants, closeSync, fstatSync, openSync, readFileSync, writeSync } from 'node:fs';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';

export const SERVICES = {
  digest: 18135,
  calendar: 18125,
  whatsapp: 18113,
  code: 18128,
  linear: 18126,
} as const;
type Service = keyof typeof SERVICES;
const COUNTERS = [
  'queryStarts',
  'transportStreamStarts',
  'documentReads',
  'documentRemoveEvents',
  'documentDeleteEvents',
  'protobufDocumentBytes',
  'listenResponseBytes',
  'receivedDocuments',
] as const;
const GAUGES = ['activeListeners', 'readyListeners', 'erroredListeners'] as const;
type Counter = (typeof COUNTERS)[number];
type Metrics = Record<Counter | (typeof GAUGES)[number], number>;
type Counters = Record<Counter, number>;
type JsonRecord = Record<string, unknown>;

export interface SafeState {
  observedAt: string | null;
  metrics: Metrics;
  mode: 'incremental' | 'legacy-bootstrap' | 'unknown';
  notifications: {
    pendingCount: number | null;
    failedCount: number | null;
    oldestPendingScheduledFor: string | null;
    lastDeliveredAt: string | null;
  } | null;
  jobs: {
    total: number;
    never: number;
    running: number;
    succeeded: number;
    failed: number;
    unknown: number;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastSucceededAt: string | null;
  };
}

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** No input property names or unrecognized strings are copied into output. */
export function sanitizeStatus(payload: unknown): SafeState | null {
  const envelope = record(payload);
  const data = record(envelope['data']);
  if (envelope['success'] !== true || data['schemaVersion'] !== 1) return null;
  const diagnostics = record(data['firestoreMonitoring']);
  const metrics = {} as Metrics;
  for (const key of [...COUNTERS, ...GAUGES]) {
    const value = count(diagnostics[key]);
    if (value === null) return null;
    metrics[key] = value;
  }
  const notificationInput = record(data['notifications']);
  const notifications =
    data['notifications'] === undefined
      ? null
      : {
          pendingCount: count(notificationInput['pendingCount']),
          failedCount: count(notificationInput['failedCount']),
          oldestPendingScheduledFor: timestamp(notificationInput['oldestPendingScheduledFor']),
          lastDeliveredAt: timestamp(notificationInput['lastDeliveredAt']),
        };
  const jobs: SafeState['jobs'] = {
    total: 0,
    never: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    unknown: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSucceededAt: null,
  };
  if (Array.isArray(data['jobs']))
    for (const entry of data['jobs']) {
      const job = record(entry);
      jobs.total++;
      const outcome = job['lastOutcome'];
      if (
        outcome === 'never' ||
        outcome === 'running' ||
        outcome === 'succeeded' ||
        outcome === 'failed'
      )
        jobs[outcome]++;
      else jobs.unknown++;
      for (const field of ['lastStartedAt', 'lastFinishedAt', 'lastSucceededAt'] as const) {
        const at = timestamp(job[field]);
        if (at !== null && (jobs[field] === null || at > jobs[field])) jobs[field] = at;
      }
    }
  const mode = diagnostics['mode'];
  return {
    observedAt: timestamp(data['observedAt']),
    metrics,
    mode: mode === 'incremental' || mode === 'legacy-bootstrap' ? mode : 'unknown',
    notifications,
    jobs,
  };
}

interface Sample {
  service: Service;
  sampledAt: string;
  statusCode: number;
  category: 'ok' | 'http_error' | 'invalid_schema' | 'request_failed';
  state: SafeState | null;
}

export interface ServiceSummary {
  samples: number;
  validSamples: number;
  statusCodes: Record<string, number>;
  resetObservations: number;
  firstSampledAt: string | null;
  lastSampledAt: string | null;
  firstState: SafeState | null;
  lastState: SafeState | null;
  cumulativeCounterIncreases: Counters;
  observedCounterDelta: Counters | null;
  minimumReadyListeners: number | null;
  maximumErroredListeners: number;
}

export function emptySummary(): ServiceSummary {
  return {
    samples: 0,
    validSamples: 0,
    statusCodes: {},
    resetObservations: 0,
    firstSampledAt: null,
    lastSampledAt: null,
    firstState: null,
    lastState: null,
    cumulativeCounterIncreases: {
      queryStarts: 0,
      transportStreamStarts: 0,
      documentReads: 0,
      documentRemoveEvents: 0,
      documentDeleteEvents: 0,
      protobufDocumentBytes: 0,
      listenResponseBytes: 0,
      receivedDocuments: 0,
    },
    observedCounterDelta: null,
    minimumReadyListeners: null,
    maximumErroredListeners: 0,
  };
}

export function updateSummary(
  summary: ServiceSummary,
  sample: Sample
): { resetObserved: boolean; delta: Counters | null } {
  summary.samples++;
  const code = String(sample.statusCode);
  summary.statusCodes[code] = (summary.statusCodes[code] ?? 0) + 1;
  if (sample.state === null) return { resetObserved: false, delta: null };
  const previous = summary.lastState;
  const current = sample.state;
  let delta: Counters | null = null;
  let resetObserved = false;
  if (previous !== null) {
    resetObserved = COUNTERS.some((key) => current.metrics[key] < previous.metrics[key]);
    if (resetObserved) summary.resetObservations++;
    delta = {} as Counters;
    for (const key of COUNTERS) {
      // After a reset only the new process's observed count is recoverable.
      delta[key] = resetObserved
        ? current.metrics[key]
        : current.metrics[key] - previous.metrics[key];
      summary.cumulativeCounterIncreases[key] += delta[key];
    }
  }
  summary.validSamples++;
  summary.firstSampledAt ??= sample.sampledAt;
  summary.lastSampledAt = sample.sampledAt;
  const firstState = summary.firstState ?? current;
  summary.firstState = firstState;
  summary.lastState = current;
  summary.minimumReadyListeners = Math.min(
    summary.minimumReadyListeners ?? Infinity,
    current.metrics.readyListeners
  );
  summary.maximumErroredListeners = Math.max(
    summary.maximumErroredListeners,
    current.metrics.erroredListeners
  );
  summary.observedCounterDelta =
    summary.resetObservations > 0
      ? null
      : (Object.fromEntries(
          COUNTERS.map((key) => [key, current.metrics[key] - firstState.metrics[key]])
        ) as Counters);
  return { resetObserved, delta };
}

function poll(service: Service, token: string): Promise<Sample> {
  const sampledAt = new Date().toISOString();
  return new Promise((resolve) => {
    const failed = (): void =>
      resolve({ service, sampledAt, statusCode: 0, category: 'request_failed', state: null });
    const outgoing = request(
      {
        hostname: '127.0.0.1',
        port: SERVICES[service],
        path: '/internal/monitoring/status',
        method: 'GET',
        headers: { 'x-internal-auth': token },
        timeout: 10000,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode !== 200) {
          response.resume();
          resolve({ service, sampledAt, statusCode, category: 'http_error', state: null });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            response.destroy();
            failed();
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', failed);
        response.on('end', () => {
          let state: SafeState | null = null;
          try {
            state = sanitizeStatus(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
          } catch {
            /* No raw errors. */
          }
          resolve({
            service,
            sampledAt,
            statusCode,
            category: state === null ? 'invalid_schema' : 'ok',
            state,
          });
        });
      }
    );
    outgoing.on('error', failed);
    outgoing.on('timeout', () => {
      outgoing.destroy();
      failed();
    });
    outgoing.end();
  });
}

export function readProtectedToken(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size < 1 ||
      stat.size > 16384 ||
      stat.uid !== process.getuid?.()
    )
      throw new Error('INVALID_TOKEN_FILE');
    const token = readFileSync(fd, 'utf8').replace(/\r?\n$/, '');
    if (!/^[\x21-\x7e]+$/.test(token)) throw new Error('INVALID_TOKEN_FILE');
    return token;
  } finally {
    closeSync(fd);
  }
}

export function parseOptions(args: string[]): {
  tokenFile: string;
  output: string | null;
  durationMs: number;
  intervalMs: number;
} {
  let tokenFile = '';
  let output: string | null = null;
  let durationMs = 1200000;
  let intervalMs = 15000;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    const value = args[++index];
    if (value === undefined) throw new Error('INVALID_ARGUMENTS');
    if (key === '--token-file') tokenFile = value;
    else if (key === '--output') output = value;
    else if (key === '--duration-seconds') durationMs = Number(value) * 1000;
    else if (key === '--interval-seconds') intervalMs = Number(value) * 1000;
    else throw new Error('INVALID_ARGUMENTS');
  }
  if (
    !tokenFile ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1000 ||
    durationMs > 86400000 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1000 ||
    intervalMs > 60000
  )
    throw new Error('INVALID_ARGUMENTS');
  return { tokenFile, output, durationMs, intervalMs };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const token = readProtectedToken(options.tokenFile);
  const output =
    options.output === null
      ? null
      : openSync(
          options.output,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600
        );
  const emit = (value: unknown): void => {
    const line = `${JSON.stringify(value)}\n`;
    if (output !== null) writeSync(output, line);
    process.stdout.write(line);
  };
  let interrupted = false;
  const interrupt = (): void => {
    interrupted = true;
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const summaries = Object.fromEntries(
    Object.keys(SERVICES).map((service) => [service, emptySummary()])
  ) as Record<Service, ServiceSummary>;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  try {
    emit({
      type: 'start',
      schemaVersion: 1,
      startedAt,
      durationMs: options.durationMs,
      intervalMs: options.intervalMs,
      byteMetric:
        'encoded Firestore Document and ListenResponse protobuf; excludes transport framing and billing',
      resetMetric:
        'counter decreases detect observable resets; work between reset and prior sample is not recoverable',
    });
    let nextPoll = start;
    while (true) {
      const samples = await Promise.all(
        (Object.keys(SERVICES) as Service[]).map((service) => poll(service, token))
      );
      for (const sample of samples)
        emit({ type: 'sample', ...sample, ...updateSummary(summaries[sample.service], sample) });
      if (interrupted || performance.now() - start >= options.durationMs) break;
      nextPoll += options.intervalMs;
      const remaining = options.durationMs - (performance.now() - start);
      const delay = Math.min(remaining, Math.max(0, nextPoll - performance.now()));
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
    emit({
      type: 'summary',
      schemaVersion: 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - start),
      requestedDurationMs: options.durationMs,
      interrupted,
      services: summaries,
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    if (output !== null) closeSync(output);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('{"status":"failed","category":"sampler_failed"}\n');
    process.exitCode = 1;
  });
}
