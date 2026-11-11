/**
 * Required environment variables for api-docs-hub.
 *
 * Each variable is the OpenAPI JSON URL of an upstream service whose docs
 * are aggregated by the full-profile hub. Static repository validation uses
 * this complete list; runtime startup validates the selected catalog through
 * `loadConfig()` so reduced profiles can omit unavailable services.
 */
import { OPEN_API_SOURCE_CATALOG } from './config.js';

export const REQUIRED_ENV: readonly string[] = OPEN_API_SOURCE_CATALOG.map(
  (entry) => entry.openApiUrlEnvVar
);
