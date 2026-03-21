/**
 * Environment configuration for api-docs-hub.
 * Validates required environment variables and fails fast on startup if missing.
 */

import {
  INTERNAL_API_OPENAPI_URL_ENV_VARS,
  buildInternalApiOpenApiSources,
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

const REQUIRED_ENV_VARS: EnvVar[] = INTERNAL_API_OPENAPI_URL_ENV_VARS.map((key) => ({ key }));

/**
 * Load and validate configuration from environment variables.
 * Throws an error if any required variable is missing.
 */
export function loadConfig(): Config {
  const missing: string[] = [];

  for (const envVar of REQUIRED_ENV_VARS) {
    const value = process.env[envVar.key];
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
    port: Number(process.env['PORT'] ?? 8080),
    host: process.env['HOST'] ?? '0.0.0.0',
    openApiSources: buildInternalApiOpenApiSources(process.env),
  };
}
