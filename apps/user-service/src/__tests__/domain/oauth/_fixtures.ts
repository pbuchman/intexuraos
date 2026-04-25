/**
 * Shared test fixtures for OAuth use-case tests.
 *
 * NOTE: filename is `_fixtures.ts` (no `.test.ts` suffix) so vitest's default
 * `**\/*.test.ts` pattern does not collect this file as a test module.
 */

import type { Logger } from '@intexuraos/common-core';

export interface CapturedLog {
  method: string;
  obj: object;
  msg?: string;
}

/**
 * Creates a fake `Logger` that records every call into the supplied `captured`
 * array. Stored as `object` (not `Record<string, unknown>`) so the production
 * `Logger` signature is matched without widening; tests cast at the read site
 * via `getLogObj()` when they need keyed access.
 */
export function makeFakeLogger(captured: CapturedLog[]): Logger {
  const push = (method: string, obj: object, msg?: string): void => {
    const entry: CapturedLog = { method, obj };
    if (msg !== undefined) {
      entry.msg = msg;
    }
    captured.push(entry);
  };
  return {
    info: (obj: object, msg?: string): void => push('info', obj, msg),
    warn: (obj: object, msg?: string): void => push('warn', obj, msg),
    error: (obj: object, msg?: string): void => push('error', obj, msg),
    debug: (obj: object, msg?: string): void => push('debug', obj, msg),
  };
}

export function getInfoCall(captured: CapturedLog[], index: number): CapturedLog {
  const infoCalls = captured.filter((c) => c.method === 'info');
  const entry = infoCalls[index];
  if (entry === undefined) {
    throw new Error(`expected info call at index ${String(index)}`);
  }
  return entry;
}

/**
 * Cast helper used at the read site only — keeps the stored shape as `object`
 * (matching the `Logger` interface) while letting tests treat captured payloads
 * as keyed records when asserting on individual fields.
 */
export function getLogObj(entry: CapturedLog): Record<string, unknown> {
  return entry.obj as Record<string, unknown>;
}
