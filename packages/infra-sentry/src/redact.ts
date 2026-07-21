/**
 * Redaction helpers for Sentry events (and any other structured payload that
 * may carry secrets).
 *
 * `SENTRY_REDACT_KEYS` is the canonical list of keys whose non-object values
 * are replaced with the literal string `[REDACTED]` before leaving the
 * process. `redactObject` walks any value recursively, returning a new copy
 * with sensitive leaves replaced.
 *
 * Behavior contract:
 * - Plain objects, arrays, primitives, `null` and `undefined` all supported.
 * - Key match is case-insensitive (so `Authorization`, `AUTHORIZATION` and
 *   `authorization` are all redacted).
 * - Only **non-object** values are replaced — when a sensitive key holds an
 *   object, recursion continues into it (so deeper sensitive leaves are still
 *   redacted).
 * - The original input is never mutated.
 * - Cycles are detected with a `WeakSet`; on a cycle the original reference
 *   is returned (so the caller's structure is not duplicated infinitely).
 */

const REDACTED = '[REDACTED]';

export const SENTRY_REDACT_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-internal-auth',
  'apiKey',
  'api_key',
  'token',
  'refreshToken',
  'password',
  'githubToken',
  'anthropicApiKey',
  'openaiApiKey',
  'x-matrix-corpus-user-id',
  'x-matrix-corpus-session-id',
  'x-matrix-corpus-lease-fence',
  'x-matrix-corpus-event-revision',
  'x-matrix-corpus-runtime-audience',
] as const;

const REDACT_KEY_SET = new Set<string>(SENTRY_REDACT_KEYS.map((k) => k.toLowerCase()));
const PRIVATE_URL_PATH_PREFIXES = [
  '/internal/intex-agent/messages',
  '/internal/matrix-corpus/',
  '/internal/test-runs/',
] as const;

function redactPrivateUrl(value: string): string {
  for (const prefix of PRIVATE_URL_PATH_PREFIXES) {
    const index = value.indexOf(prefix);
    if (index >= 0) {
      return `${value.slice(0, index)}${prefix}[REDACTED]`;
    }
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  // Accept only plain object literals — class instances (Date, Map, Buffer,
  // Error, etc.) carry non-data properties that should not be walked as
  // structured payloads.
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

function shouldRedactKey(key: string): boolean {
  return REDACT_KEY_SET.has(key.toLowerCase());
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
    return value.map((item) => walk(item, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (shouldRedactKey(key) && !isPlainObject(child) && !Array.isArray(child)) {
        out[key] = REDACTED;
      } else {
        out[key] = walk(child, seen);
      }
    }
    return out;
  }

  if (typeof value === 'string') {
    return redactPrivateUrl(value);
  }

  return value;
}

/**
 * Recursively redact values under sensitive keys.
 *
 * Returns a new value (or the original primitive) with every leaf living
 * under a `SENTRY_REDACT_KEYS` key replaced by `'[REDACTED]'`. Objects/arrays
 * found under a sensitive key are walked instead of redacted wholesale, so
 * deeper secrets are still scrubbed.
 */
export function redactObject<T>(value: T): T {
  return walk(value, new WeakSet<object>()) as T;
}
