/**
 * Environment configuration for api-docs-hub.
 * Validates required environment variables and fails fast on startup if missing.
 */

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
  displayName: string;
}

const REQUIRED_ENV_VARS: EnvVar[] = [
  { key: 'AUTH_SERVICE_OPENAPI_URL', displayName: 'Auth Service API' },
  { key: 'PROMPTVAULT_SERVICE_OPENAPI_URL', displayName: 'PromptVault Service API' },
  { key: 'NOTION_SERVICE_OPENAPI_URL', displayName: 'Notion Service API' },
  { key: 'WHATSAPP_SERVICE_OPENAPI_URL', displayName: 'WhatsApp Service API' },
  {
    key: 'MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL',
    displayName: 'Mobile Notifications Service API',
  },
];

/**
 * Load and validate configuration from environment variables.
 * Throws an error if any required variable is missing.
 */
export function loadConfig(): Config {
  const missing: string[] = [];
  const openApiSources: OpenApiSource[] = [];

  for (const envVar of REQUIRED_ENV_VARS) {
    const value = process.env[envVar.key];
    if (value === undefined || value === '') {
      missing.push(envVar.key);
    } else {
      openApiSources.push({
        name: envVar.displayName,
        url: value,
      });
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
    openApiSources,
  };
}
