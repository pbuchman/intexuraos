/**
 * Environment configuration for api-docs-hub.
 * Validates required environment variables and fails fast on startup if missing.
 */

import {
  INTERNAL_API_SERVICE_CATALOG,
  INTERNAL_API_OPENAPI_URL_ENV_VARS,
} from '@intexuraos/common-core';

export interface OpenApiSource {
  name: string;
  url: string;
}

export interface Config {
  port: number;
  host: string;
  openApiSources: OpenApiSource[];
}

interface EnvVar {
  key: string;
}

const OPENAPI_URL_ENV_VARS = INTERNAL_API_OPENAPI_URL_ENV_VARS as readonly string[];
const API_SERVICE_CATALOG = INTERNAL_API_SERVICE_CATALOG as readonly {
  apiDocsName: string;
  openApiUrlEnvVar: string;
}[];

const REQUIRED_ENV_VARS: EnvVar[] = OPENAPI_URL_ENV_VARS.map((key): EnvVar => ({ key }));

/**
 * Load and validate configuration from environment variables.
 * Throws an error if any required variable is missing.
 */
export function loadConfig(): Config {
  const missing: string[] = [];
  const env = process.env as Record<string, string | undefined>;

  for (const envVar of REQUIRED_ENV_VARS) {
    const value = env[envVar.key];
    if (value === undefined || value === '') {
      missing.push(envVar.key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'These must be set to the OpenAPI JSON URLs of each service.'
    );
  }

  return {
    port: Number(env['PORT'] ?? 8080),
    host: env['HOST'] ?? '0.0.0.0',
    openApiSources: API_SERVICE_CATALOG.flatMap((entry): OpenApiSource[] => {
      const url = env[entry.openApiUrlEnvVar]?.trim() ?? '';
      if (url === '') {
        return [];
      }
      return [{ name: entry.apiDocsName, url }];
    }),
  };
}
