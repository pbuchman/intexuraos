// TEMPORARY SHIM — to be deleted when @intexuraos/common-worker lands on `development`.
// See docs/plans/2026-04-24-workers-layer-refactor.md §4 for the migration plan.
// The exported API surface here MUST stay byte-compatible with the eventual
// @intexuraos/common-worker package so the swap is a single-commit rename.

import pino from 'pino';
import { timingSafeEqual } from 'node:crypto';
import { serializeError } from '@intexuraos/common-core';

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
