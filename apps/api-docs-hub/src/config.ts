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
  { service: 'user-service', name: 'User Service API', openApiUrlEnvVar: 'INTEXURAOS_USER_SERVICE_OPENAPI_URL' },
  { service: 'notion-service', name: 'Notion Service API', openApiUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_OPENAPI_URL' },
  { service: 'whatsapp-service', name: 'WhatsApp Service API', openApiUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL' },
  { service: 'mobile-notifications-service', name: 'Mobile Notifications Service API', openApiUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL' },
  { service: 'message-digest-service', name: 'Message Digest Service API', openApiUrlEnvVar: 'INTEXURAOS_MESSAGE_DIGEST_SERVICE_OPENAPI_URL' },
  { service: 'fishing-assistant-service', name: 'Fishing Assistant Service API', openApiUrlEnvVar: 'INTEXURAOS_FISHING_ASSISTANT_SERVICE_OPENAPI_URL' },
  { service: 'research-agent', name: 'Research Agent API', openApiUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL' },
  { service: 'image-service', name: 'Image Service API', openApiUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL' },
  { service: 'app-settings-service', name: 'Application Settings API', openApiUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL' },
  { service: 'notes-agent', name: 'Notes Agent API', openApiUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_OPENAPI_URL' },
  { service: 'bookmarks-agent', name: 'Bookmarks Agent API', openApiUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL' },
  { service: 'calendar-agent', name: 'Calendar Agent API', openApiUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL' },
  { service: 'code-agent', name: 'Code Agent API', openApiUrlEnvVar: 'INTEXURAOS_CODE_AGENT_OPENAPI_URL' },
  { service: 'linear-agent', name: 'Linear Agent API', openApiUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_OPENAPI_URL' },
  { service: 'web-agent', name: 'Web Agent API', openApiUrlEnvVar: 'INTEXURAOS_WEB_AGENT_OPENAPI_URL' },
  { service: 'hellscript-agent', name: 'Hellscript Agent API', openApiUrlEnvVar: 'INTEXURAOS_HELLSCRIPT_AGENT_OPENAPI_URL' },
  { service: 'intex-agent', name: 'Intex Agent API', openApiUrlEnvVar: 'INTEXURAOS_INTEX_AGENT_OPENAPI_URL' },
] as const;

function expectedCatalog(env: Record<string, string | undefined>): typeof OPEN_API_SOURCE_CATALOG[number][] {
  const configured = env['INTEXURAOS_API_DOCS_EXPECTED_SERVICES'];
  if (configured === undefined) return [...OPEN_API_SOURCE_CATALOG];

  const services = configured.split(',').map((service) => service.trim());
  if (services.length === 0 || services.some((service) => service === '')) {
    throw new Error('INTEXURAOS_API_DOCS_EXPECTED_SERVICES must contain at least one service');
  }
  const seen = new Set<string>();
  for (const service of services) {
    if (seen.has(service)) {
      throw new Error(
        `INTEXURAOS_API_DOCS_EXPECTED_SERVICES contains duplicate service: ${service}`
      );
    }
    seen.add(service);
  }

  const knownServices = new Set<string>(OPEN_API_SOURCE_CATALOG.map((entry) => entry.service));
  for (const service of services) {
    if (!knownServices.has(service)) {
      throw new Error(
        `INTEXURAOS_API_DOCS_EXPECTED_SERVICES contains unknown service: ${service}`
      );
    }
  }
  return OPEN_API_SOURCE_CATALOG.filter((entry) => seen.has(entry.service));
}

function buildOpenApiSources(
  env: Record<string, string | undefined>,
  catalog: readonly ((typeof OPEN_API_SOURCE_CATALOG)[number])[]
): OpenApiSource[] {
  return catalog.flatMap((entry): OpenApiSource[] => {
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
  const catalog = expectedCatalog(env);
  const requiredEnvVars: EnvVar[] = catalog.map(
    ({ openApiUrlEnvVar }): EnvVar => ({ key: openApiUrlEnvVar })
  );

  for (const envVar of requiredEnvVars) {
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
    openApiSources: buildOpenApiSources(env, catalog),
  };
}
