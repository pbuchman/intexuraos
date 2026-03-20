export interface InternalApiServiceCatalogEntry {
  key: string;
  name: string;
  apiDocsName: string;
  baseUrlEnvVar: string;
  openApiUrlEnvVar: string;
}

export interface InternalApiServiceDefinition {
  key: string;
  name: string;
  url: string;
  openapiUrl: string;
}

export interface InternalApiOpenApiSource {
  key: string;
  name: string;
  url: string;
}

export const INTERNAL_API_SERVICE_CATALOG: InternalApiServiceCatalogEntry[] = [
  {
    key: 'user-service',
    name: 'User Service',
    apiDocsName: 'User Service API',
    baseUrlEnvVar: 'INTEXURAOS_USER_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_USER_SERVICE_OPENAPI_URL',
  },
  {
    key: 'notion-service',
    name: 'Notion Service',
    apiDocsName: 'Notion Service API',
    baseUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_OPENAPI_URL',
  },
  {
    key: 'whatsapp-service',
    name: 'WhatsApp Service',
    apiDocsName: 'WhatsApp Service API',
    baseUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL',
  },
  {
    key: 'mobile-notifications-service',
    name: 'Mobile Notifications Service',
    apiDocsName: 'Mobile Notifications Service API',
    baseUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL',
  },
  {
    key: 'research-agent',
    name: 'Research Agent',
    apiDocsName: 'Research Agent API',
    baseUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL',
  },
  {
    key: 'commands-agent',
    name: 'Commands Agent',
    apiDocsName: 'Commands Agent API',
    baseUrlEnvVar: 'INTEXURAOS_COMMANDS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_COMMANDS_AGENT_OPENAPI_URL',
  },
  {
    key: 'actions-agent',
    name: 'Actions Agent',
    apiDocsName: 'Actions Agent API',
    baseUrlEnvVar: 'INTEXURAOS_ACTIONS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL',
  },
  {
    key: 'data-insights-agent',
    name: 'Data Insights Agent',
    apiDocsName: 'Data Insights Agent API',
    baseUrlEnvVar: 'INTEXURAOS_DATA_INSIGHTS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_DATA_INSIGHTS_AGENT_OPENAPI_URL',
  },
  {
    key: 'image-service',
    name: 'Image Service',
    apiDocsName: 'Image Service API',
    baseUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL',
  },
  {
    key: 'app-settings-service',
    name: 'Application Settings Service',
    apiDocsName: 'Application Settings API',
    baseUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL',
  },
  {
    key: 'notes-agent',
    name: 'Notes Agent',
    apiDocsName: 'Notes Agent API',
    baseUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_OPENAPI_URL',
  },
  {
    key: 'todos-agent',
    name: 'Todos Agent',
    apiDocsName: 'Todos Agent API',
    baseUrlEnvVar: 'INTEXURAOS_TODOS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_TODOS_AGENT_OPENAPI_URL',
  },
  {
    key: 'bookmarks-agent',
    name: 'Bookmarks Agent',
    apiDocsName: 'Bookmarks Agent API',
    baseUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL',
  },
  {
    key: 'calendar-agent',
    name: 'Calendar Agent',
    apiDocsName: 'Calendar Agent API',
    baseUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL',
  },
  {
    key: 'chat-agent',
    name: 'Chat Agent',
    apiDocsName: 'Chat Agent API',
    baseUrlEnvVar: 'INTEXURAOS_CHAT_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CHAT_AGENT_OPENAPI_URL',
  },
  {
    key: 'code-agent',
    name: 'Code Agent',
    apiDocsName: 'Code Agent API',
    baseUrlEnvVar: 'INTEXURAOS_CODE_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CODE_AGENT_OPENAPI_URL',
  },
  {
    key: 'linear-agent',
    name: 'Linear Agent',
    apiDocsName: 'Linear Agent API',
    baseUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_OPENAPI_URL',
  },
  {
    key: 'web-agent',
    name: 'Web Agent',
    apiDocsName: 'Web Agent API',
    baseUrlEnvVar: 'INTEXURAOS_WEB_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_WEB_AGENT_OPENAPI_URL',
  },
  {
    key: 'cron-agent',
    name: 'Cron Agent',
    apiDocsName: 'Cron Agent API',
    baseUrlEnvVar: 'INTEXURAOS_CRON_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CRON_AGENT_OPENAPI_URL',
  },
];

export const INTERNAL_API_BASE_URL_ENV_VARS = INTERNAL_API_SERVICE_CATALOG.map(
  (entry) => entry.baseUrlEnvVar
);

export const INTERNAL_API_OPENAPI_URL_ENV_VARS = INTERNAL_API_SERVICE_CATALOG.map(
  (entry) => entry.openApiUrlEnvVar
);

export function buildInternalApiServiceDefinitions(
  env: Record<string, string | undefined>
): InternalApiServiceDefinition[] {
  return INTERNAL_API_SERVICE_CATALOG.flatMap((entry) => {
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

export function buildInternalApiOpenApiSources(
  env: Record<string, string | undefined>
): InternalApiOpenApiSource[] {
  return INTERNAL_API_SERVICE_CATALOG.flatMap((entry) => {
    const url = env[entry.openApiUrlEnvVar]?.trim() ?? '';
    if (url === '') {
      return [];
    }
    return [
      {
        key: entry.key,
        name: entry.apiDocsName,
        url,
      },
    ];
  });
}
