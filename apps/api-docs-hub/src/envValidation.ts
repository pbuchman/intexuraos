/**
 * Required environment variables for api-docs-hub.
 *
 * Each variable is the OpenAPI JSON URL of an upstream service whose docs
 * are aggregated by this hub. The list is the single source of truth used by
 * `validateRequiredEnv()` at module load — keep it in sync with
 * `OPEN_API_SOURCE_CATALOG` in `config.ts`.
 */
import { OPEN_API_SOURCE_CATALOG } from './config.js';

export const REQUIRED_ENV: readonly string[] = OPEN_API_SOURCE_CATALOG.map(
  (entry) => entry.openApiUrlEnvVar
);
