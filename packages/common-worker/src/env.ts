/**
 * loadRequiredEnv — fail-fast environment variable loader for workers.
 *
 * Reads `process.env` against a typed spec and either returns a frozen
 * `Readonly<Record<string, string>>` shape or throws at module load with
 * EVERY missing required var listed in a single error. Empty string is
 * treated as missing — a half-templated env file is the most common silent
 * misconfiguration we want to surface.
 *
 * Optional vars honour `default`; without a default they fall back to the
 * empty string, which callers must handle explicitly.
 *
 * Differs from `@intexuraos/common-core`'s `loadEnv` (positional list of
 * keys, all required) by supporting per-key required/default semantics —
 * which the worker config files in `workers/transcription/types.ts` and
 * `workers/vm-lifecycle/config.ts` need.
 */

export interface EnvVarSpec {
  readonly required: boolean;
  readonly default?: string;
}

export type EnvSpec = Readonly<Record<string, EnvVarSpec>>;

export type LoadedEnv<T extends EnvSpec> = { readonly [K in keyof T]: string };

export function loadRequiredEnv<T extends EnvSpec>(spec: T): LoadedEnv<T> {
  const missing: string[] = [];
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(spec)) {
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
