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
}

export const OPEN_API_SOURCE_CATALOG = [
  { name: 'User Service API', openApiUrlEnvVar: 'INTEXURAOS_USER_SERVICE_OPENAPI_URL' },
  { name: 'Notion Service API', openApiUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_OPENAPI_URL' },
  { name: 'WhatsApp Service API', openApiUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL' },
  { name: 'Mobile Notifications Service API', openApiUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL' },
  { name: 'Research Agent API', openApiUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL' },
  { name: 'Commands Agent API', openApiUrlEnvVar: 'INTEXURAOS_COMMANDS_AGENT_OPENAPI_URL' },
  { name: 'Actions Agent API', openApiUrlEnvVar: 'INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL' },
  { name: 'Data Insights Agent API', openApiUrlEnvVar: 'INTEXURAOS_DATA_INSIGHTS_AGENT_OPENAPI_URL' },
  { name: 'Image Service API', openApiUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL' },
  { name: 'Application Settings API', openApiUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL' },
  { name: 'Notes Agent API', openApiUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_OPENAPI_URL' },
  { name: 'Todos Agent API', openApiUrlEnvVar: 'INTEXURAOS_TODOS_AGENT_OPENAPI_URL' },
  { name: 'Bookmarks Agent API', openApiUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL' },
  { name: 'Calendar Agent API', openApiUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL' },
  { name: 'Chat Agent API', openApiUrlEnvVar: 'INTEXURAOS_CHAT_AGENT_OPENAPI_URL' },
  { name: 'Code Agent API', openApiUrlEnvVar: 'INTEXURAOS_CODE_AGENT_OPENAPI_URL' },
  { name: 'Linear Agent API', openApiUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_OPENAPI_URL' },
  { name: 'Web Agent API', openApiUrlEnvVar: 'INTEXURAOS_WEB_AGENT_OPENAPI_URL' },
  { name: 'Cron Agent API', openApiUrlEnvVar: 'INTEXURAOS_CRON_AGENT_OPENAPI_URL' },
  { name: 'Hellscript Agent API', openApiUrlEnvVar: 'INTEXURAOS_HELLSCRIPT_AGENT_OPENAPI_URL' },
] as const;

const REQUIRED_ENV_VARS: EnvVar[] = OPEN_API_SOURCE_CATALOG.map(
  ({ openApiUrlEnvVar }): EnvVar => ({ key: openApiUrlEnvVar })
);

function buildOpenApiSources(
  env: Record<string, string | undefined>
): OpenApiSource[] {
  return OPEN_API_SOURCE_CATALOG.flatMap((entry): OpenApiSource[] => {
    const url = env[entry.openApiUrlEnvVar]?.trim() ?? '';
    if (url === '') {
      return [];
    }

    return [
      {
        name: entry.name,
        url,
      },
    ];
  });
}

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
    openApiSources: buildOpenApiSources(env),
  };
}
