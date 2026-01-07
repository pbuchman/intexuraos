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
  { key: 'INTEXURAOS_USER_SERVICE_OPENAPI_URL', displayName: 'User Service API' },
  { key: 'INTEXURAOS_PROMPTVAULT_SERVICE_OPENAPI_URL', displayName: 'PromptVault Service API' },
  { key: 'INTEXURAOS_NOTION_SERVICE_OPENAPI_URL', displayName: 'Notion Service API' },
  { key: 'INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL', displayName: 'WhatsApp Service API' },
  {
    key: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL',
    displayName: 'Mobile Notifications Service API',
  },
  {
    key: 'INTEXURAOS_LLM_ORCHESTRATOR_OPENAPI_URL',
    displayName: 'LLM Orchestrator API',
  },
  {
    key: 'INTEXURAOS_COMMANDS_ROUTER_OPENAPI_URL',
    displayName: 'Commands Router API',
  },
  {
    key: 'INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL',
    displayName: 'Actions Agent API',
  },
  {
    key: 'INTEXURAOS_DATA_INSIGHTS_SERVICE_OPENAPI_URL',
    displayName: 'Data Insights Service API',
  },
  {
    key: 'INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL',
    displayName: 'Image Service API',
  },
  {
    key: 'INTEXURAOS_NOTES_AGENT_OPENAPI_URL',
    displayName: 'Notes Agent API',
  },
  {
    key: 'INTEXURAOS_TODOS_AGENT_OPENAPI_URL',
    displayName: 'Todos Agent API',
  },
  {
    key: 'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
    displayName: 'Application Settings API',
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
