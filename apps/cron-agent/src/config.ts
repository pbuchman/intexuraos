export interface ServiceDefinition {
  key: string;
  name: string;
  url: string;
  openapiUrl: string;
  allowedOperations?: string[] | undefined;
}

export interface CronAgentConfig {
  port: number;
  gcpProjectId: string;
  internalAuthToken: string;
  authAudience: string;
  authIssuer: string;
  authJwksUrl: string;
  sentryDsn: string;
  environment: string;
  allowedServices: ServiceDefinition[];
  geminiApiKey: string;
}

const INTERNAL_API_SERVICE_CATALOG = [
  {
    key: 'user-service',
    name: 'User Service',
    baseUrlEnvVar: 'INTEXURAOS_USER_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_USER_SERVICE_OPENAPI_URL',
  },
  {
    key: 'notion-service',
    name: 'Notion Service',
    baseUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_OPENAPI_URL',
  },
  {
    key: 'whatsapp-service',
    name: 'WhatsApp Service',
    baseUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL',
  },
  {
    key: 'mobile-notifications-service',
    name: 'Mobile Notifications Service',
    baseUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL',
  },
  {
    key: 'research-agent',
    name: 'Research Agent',
    baseUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL',
  },
  {
    key: 'commands-agent',
    name: 'Commands Agent',
    baseUrlEnvVar: 'INTEXURAOS_COMMANDS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_COMMANDS_AGENT_OPENAPI_URL',
  },
  {
    key: 'actions-agent',
    name: 'Actions Agent',
    baseUrlEnvVar: 'INTEXURAOS_ACTIONS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL',
  },
  {
    key: 'data-insights-agent',
    name: 'Data Insights Agent',
    baseUrlEnvVar: 'INTEXURAOS_DATA_INSIGHTS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_DATA_INSIGHTS_AGENT_OPENAPI_URL',
  },
  {
    key: 'image-service',
    name: 'Image Service',
    baseUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL',
  },
  {
    key: 'app-settings-service',
    name: 'Application Settings Service',
    baseUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL',
  },
  {
    key: 'notes-agent',
    name: 'Notes Agent',
    baseUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_OPENAPI_URL',
  },
  {
    key: 'todos-agent',
    name: 'Todos Agent',
    baseUrlEnvVar: 'INTEXURAOS_TODOS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_TODOS_AGENT_OPENAPI_URL',
  },
  {
    key: 'bookmarks-agent',
    name: 'Bookmarks Agent',
    baseUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL',
  },
  {
    key: 'calendar-agent',
    name: 'Calendar Agent',
    baseUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL',
  },
  {
    key: 'chat-agent',
    name: 'Chat Agent',
    baseUrlEnvVar: 'INTEXURAOS_CHAT_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CHAT_AGENT_OPENAPI_URL',
  },
  {
    key: 'code-agent',
    name: 'Code Agent',
    baseUrlEnvVar: 'INTEXURAOS_CODE_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CODE_AGENT_OPENAPI_URL',
  },
  {
    key: 'linear-agent',
    name: 'Linear Agent',
    baseUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_OPENAPI_URL',
  },
  {
    key: 'web-agent',
    name: 'Web Agent',
    baseUrlEnvVar: 'INTEXURAOS_WEB_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_WEB_AGENT_OPENAPI_URL',
  },
  {
    key: 'cron-agent',
    name: 'Cron Agent',
    baseUrlEnvVar: 'INTEXURAOS_CRON_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CRON_AGENT_OPENAPI_URL',
  },
  {
    key: 'hellscript-agent',
    name: 'Hellscript Agent',
    baseUrlEnvVar: 'INTEXURAOS_HELLSCRIPT_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_HELLSCRIPT_AGENT_OPENAPI_URL',
  },
] as const;

function buildAllowedServices(
  env: Record<string, string | undefined>
): ServiceDefinition[] {
  return INTERNAL_API_SERVICE_CATALOG.flatMap((entry): ServiceDefinition[] => {
    const url = env[entry.baseUrlEnvVar]?.trim() ?? '';
    if (url === '') {
      return [];
    }

    const explicitOpenApiUrl = env[entry.openApiUrlEnvVar]?.trim() ?? '';
    return [
      {
        key: entry.key,
        name: entry.name,
        url,
        openapiUrl: explicitOpenApiUrl !== '' ? explicitOpenApiUrl : `${url}/openapi.json`,
      },
    ];
  });
}

export function loadConfig(): CronAgentConfig {
  const allowedServices = buildAllowedServices(process.env);

  return {
    port: parseInt(process.env['PORT'] ?? '8080', 10),
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    authAudience: process.env['INTEXURAOS_AUTH_AUDIENCE'] ?? '',
    authIssuer: process.env['INTEXURAOS_AUTH_ISSUER'] ?? '',
    authJwksUrl: process.env['INTEXURAOS_AUTH_JWKS_URL'] ?? '',
    sentryDsn: process.env['INTEXURAOS_SENTRY_DSN'] ?? '',
    environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
    allowedServices,
    geminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'] ?? '',
  };
}
