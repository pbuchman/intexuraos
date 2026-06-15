/**
 * Typed environment variable loader.
 *
 * Returns a `Record<K, string>` where every key is guaranteed to be a non-empty
 * string. Throws if any key is missing or empty, listing all offenders so the
 * error is actionable in one shot.
 *
 * Intended to be called AFTER {@link validateRequiredEnv} (or as the only
 * presence check in callers that prefer this typed shape) so downstream code
 * can read env values without `process.env[k] ?? ''` fallbacks or `as string`
 * casts.
 *
 * @example
 * ```ts
 * const env = loadEnv(['INTEXURAOS_GCP_PROJECT_ID', 'INTEXURAOS_AUTH0_DOMAIN'] as const);
 * // env.INTEXURAOS_GCP_PROJECT_ID is `string`, not `string | undefined`.
 * ```
 */
export function loadEnv<K extends string>(keys: readonly K[]): Record<K, string> {
  const missing: string[] = [];
  const result = {} as Record<K, string>;
  for (const key of keys) {
    const value = process.env[key];
    if (value === undefined || value === '') {
      missing.push(key);
      continue;
    }
    result[key] = value;
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        `Ensure these are set in Terraform env_vars or .envrc.local for local development.`
    );
  }
  return result;
}
