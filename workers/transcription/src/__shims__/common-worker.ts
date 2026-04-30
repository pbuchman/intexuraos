// TEMPORARY SHIM — to be deleted when @intexuraos/common-worker lands on `development`.
// See docs/plans/2026-04-24-workers-layer-refactor.md §4 for the migration plan.
// The exported API surface here MUST stay byte-compatible with the eventual
// @intexuraos/common-worker package so the swap is a single-commit rename.

import type { CloudEvent } from '@google-cloud/functions-framework';
import { timingSafeEqual } from 'node:crypto';
import pino from 'pino';
import { serializeError } from '@intexuraos/common-core';

// ---------------------------------------------------------------------------
// logger
// ---------------------------------------------------------------------------

export interface WorkerLogger {
  readonly level: string;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): WorkerLogger;
}

export function createWorkerLogger(name: string): WorkerLogger {
  return pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { worker: name },
    formatters: { level: (label: string): { level: string } => ({ level: label }) },
    serializers: { error: serializeError, err: serializeError },
  }) as unknown as WorkerLogger;
}

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

export interface EnvVarSpec {
  readonly required: boolean;
  readonly default?: string;
}
export type EnvSpec = Readonly<Record<string, EnvVarSpec>>;
export type LoadedEnv<T extends EnvSpec> = { readonly [K in keyof T]: string };

export function loadRequiredEnv<T extends EnvSpec>(spec: T): LoadedEnv<T> {
  const missing: string[] = [];
  const out: Record<string, string> = {};
  for (const key of Object.keys(spec)) {
    const entry = spec[key];
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess narrowing only; key always present since we iterate Object.keys(spec) @preserve */
    if (entry === undefined) continue;
    /* v8 ignore stop @preserve */
    const raw = process.env[key];
    if (raw === undefined || raw === '') {
      if (entry.required) {
        missing.push(key);
      } else {
        out[key] = entry.default ?? '';
      }
    } else {
      out[key] = raw;
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
  return out as LoadedEnv<T>;
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

export function verifyInternalAuth(
  headerValue: string | string[] | undefined,
  expectedToken: string | undefined // @allow-undefined-type -- API surface mirrors @intexuraos/common-worker §3.3 spec; callers pass process.env[...] directly
): boolean {
  if (expectedToken === undefined || expectedToken === '') return false;
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (header === undefined || header === '') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// observability
// ---------------------------------------------------------------------------

// String-literal enum (not `const enum`) so the runtime values are accessible
// to consumers and tests; the eventual package's `const enum` form will erase
// to identical literals at the call sites here.
export const AckDecision = {
  Ack: 'ack',
  Nack: 'nack',
  DeadLetter: 'dlq',
} as const;
export type AckDecision = (typeof AckDecision)[keyof typeof AckDecision];

export interface AckResult {
  readonly decision: AckDecision;
  readonly reason?: string;
}

export type CloudEventHandler<D> = (
  event: CloudEvent<D>,
  logger: WorkerLogger
) => Promise<AckResult>;

export interface ObservabilityOptions {
  readonly sentryDsn?: string;
  readonly dlqPublish?: (payload: unknown, reason: string) => Promise<void>;
  /**
   * Optional pre-configured base logger. When supplied, `withObservability`
   * uses it instead of `createWorkerLogger(handlerName)`. Allows callers that
   * already bootstrap a Sentry-integrated pino logger (via
   * `@intexuraos/infra-sentry`'s `initWorker`) to keep that single logger
   * instance flowing through the wrapper — Sentry capture for warn/error
   * logs is handled by the logger's own stream pipeline, so the wrapper does
   * not import `@sentry/node` directly.
   *
   * NOTE: This field is shim-only — it does not appear in the frozen §3.3
   * contract. Callers using the eventual `@intexuraos/common-worker` package
   * should drop this field and rely on `createWorkerLogger` + `sentryDsn`.
   */
  readonly baseLogger?: WorkerLogger;
}

/**
 * Wrap a CloudEvent handler with structured request logging and Pub/Sub
 * ack/nack/DLQ semantics translation.
 *
 * Contract enforced:
 * - `Ack`        → resolve (Pub/Sub ACKs).
 * - `Nack`       → throw (Pub/Sub redelivers; triggers subscription retry policy).
 * - `DeadLetter` → if `opts.dlqPublish` provided: publish payload + reason to
 *                  DLQ and resolve. Otherwise: WARN log + throw (degrade to Nack).
 * - Handler throws → logged at error level (which routes to Sentry via the
 *                    logger's own stream when a Sentry DSN is configured) and
 *                    re-thrown so Pub/Sub redelivers (Nack semantics).
 *
 * `opts.sentryDsn` is currently a marker to indicate the caller has wired
 * Sentry via `@intexuraos/infra-sentry`'s `initWorker` outside of this
 * wrapper; the shim does not call `Sentry.captureException` directly so it
 * stays free of a hard `@sentry/node` dependency.
 *
 * Emits structured `worker_request_*` log lines on entry and at every exit
 * branch.
 */
export function withObservability<D>(
  handlerName: string,
  handler: CloudEventHandler<D>,
  opts: ObservabilityOptions = {}
): (event: CloudEvent<D>) => Promise<void> {
  const logger = opts.baseLogger ?? createWorkerLogger(handlerName);
  return async (event: CloudEvent<D>): Promise<void> => {
    logger.info(
      { event: 'worker_request_start', handlerName, eventId: event.id },
      'worker request start'
    );
    let result: AckResult;
    try {
      result = await handler(event, logger);
    } catch (error) {
      logger.error(
        { event: 'worker_request_error', handlerName, eventId: event.id, error },
        'handler threw'
      );
      throw error;
    }

    if (result.decision === AckDecision.Ack) {
      logger.info(
        { event: 'worker_request_ack', handlerName, eventId: event.id },
        'worker request ack'
      );
      return;
    }

    if (result.decision === AckDecision.Nack) {
      logger.warn(
        {
          event: 'worker_request_nack',
          handlerName,
          eventId: event.id,
          reason: result.reason,
        },
        'worker request nack'
      );
      throw new Error(`nack: ${result.reason ?? 'unspecified'}`);
    }

    // DeadLetter
    const reason = result.reason ?? 'dlq';
    if (opts.dlqPublish !== undefined) {
      await opts.dlqPublish(event.data, reason);
      logger.warn(
        { event: 'worker_request_dlq', handlerName, eventId: event.id, reason },
        'worker request dead-lettered'
      );
      return;
    }

    logger.warn(
      {
        event: 'worker_request_dlq_missing_publisher',
        handlerName,
        eventId: event.id,
        reason,
      },
      'DLQ requested but no publisher configured — degrading to nack'
    );
    throw new Error(`dlq (no publisher): ${reason}`);
  };
}

// ---------------------------------------------------------------------------
// testing helpers (mirrors @intexuraos/common-worker/testing subpath)
// ---------------------------------------------------------------------------

export interface FakeLogger extends WorkerLogger {
  readonly entries: { level: string; obj: object; msg?: string }[];
  // Narrow the WorkerLogger return type so tests can read `child.entries`
  // without casting.
  child(bindings: Record<string, unknown>): FakeLogger;
}

export function createFakeLogger(level = 'debug'): FakeLogger {
  const entries: FakeLogger['entries'] = [];
  const rec =
    (lvl: string) =>
    (obj: object, msg?: string): void => {
      const entry: FakeLogger['entries'][number] = { level: lvl, obj };
      if (msg !== undefined) entry.msg = msg;
      entries.push(entry);
    };
  const logger: FakeLogger = {
    level,
    entries,
    info: rec('info'),
    warn: rec('warn'),
    error: rec('error'),
    debug: rec('debug'),
    child: (): FakeLogger => createFakeLogger(level),
  };
  return logger;
}

interface PubSubMessage {
  data?: string;
  attributes?: Record<string, string>;
}
interface PubSubData {
  message: PubSubMessage;
}

/**
 * Build a Pub/Sub `CloudEvent<PubSubData>` for tests.
 *
 * `payload` is JSON-encoded then base64-encoded into `event.data.message.data`.
 * Pass `messageOverride` to bypass the default base64 encoding (e.g. to inject
 * a non-string `data` field, omit it entirely, or supply pre-built attributes).
 */
export function makePubSubCloudEvent(
  payload: unknown,
  overrides: Partial<Omit<CloudEvent<PubSubData>, 'data'>> = {},
  messageOverride?: PubSubMessage
): CloudEvent<PubSubData> {
  const message: PubSubMessage =
    messageOverride ??
    ({
      data: Buffer.from(JSON.stringify(payload)).toString('base64'),
      attributes: {},
    } satisfies PubSubMessage);
  return {
    id: 'test-event-id',
    source: 'test',
    type: 'google.cloud.pubsub.topic.v1.messagePublished',
    specversion: '1.0',
    ...overrides,
    data: { message },
  } as CloudEvent<PubSubData>;
}
