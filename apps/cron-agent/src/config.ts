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
    allowedOperations: [] as readonly string[],
  },
  {
    key: 'notion-service',
    name: 'Notion Service',
    baseUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_OPENAPI_URL',
    allowedOperations: ['getInternalNotionContext', 'getPagePreview'] as readonly string[],
  },
  {
    key: 'whatsapp-service',
    name: 'WhatsApp Service',
    baseUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL',
    allowedOperations: [] as readonly string[],
  },
  {
    key: 'mobile-notifications-service',
    name: 'Mobile Notifications Service',
    baseUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL',
    allowedOperations: ['queryNotificationsInternal'] as readonly string[],
  },
  {
    key: 'research-agent',
    name: 'Research Agent',
    baseUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL',
    allowedOperations: ['createInternalResearchDraft'] as readonly string[],
  },
  {
    key: 'commands-agent',
    name: 'Commands Agent',
    baseUrlEnvVar: 'INTEXURAOS_COMMANDS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_COMMANDS_AGENT_OPENAPI_URL',
    allowedOperations: [] as readonly string[],
  },
  {
    key: 'actions-agent',
    name: 'Actions Agent',
    baseUrlEnvVar: 'INTEXURAOS_ACTIONS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL',
    allowedOperations: ['createAction'] as readonly string[],
  },
  {
    key: 'data-insights-agent',
    name: 'Data Insights Agent',
    baseUrlEnvVar: 'INTEXURAOS_DATA_INSIGHTS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_DATA_INSIGHTS_AGENT_OPENAPI_URL',
    allowedOperations: ['computeVisualization'] as readonly string[],
  },
  {
    key: 'image-service',
    name: 'Image Service',
    baseUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL',
    allowedOperations: ['generatePromptInternal', 'generateImageInternal'] as readonly string[],
  },
  {
    key: 'app-settings-service',
    name: 'Application Settings Service',
    baseUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL',
    allowedOperations: [] as readonly string[],
  },
  {
    key: 'notes-agent',
    name: 'Notes Agent',
    baseUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_OPENAPI_URL',
    allowedOperations: ['createNoteInternal'] as readonly string[],
  },
  {
    key: 'todos-agent',
    name: 'Todos Agent',
    baseUrlEnvVar: 'INTEXURAOS_TODOS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_TODOS_AGENT_OPENAPI_URL',
    allowedOperations: ['createTodoInternal'] as readonly string[],
  },
  {
    key: 'bookmarks-agent',
    name: 'Bookmarks Agent',
    baseUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL',
    allowedOperations: ['createBookmarkInternal', 'getBookmarkInternal', 'updateBookmarkInternal'] as readonly string[],
  },
  {
    key: 'calendar-agent',
    name: 'Calendar Agent',
    baseUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL',
    allowedOperations: ['processCalendarAction', 'generateCalendarPreview', 'getCalendarPreview', 'generateCalendarPreviewDirect'] as readonly string[],
  },
  {
    key: 'chat-agent',
    name: 'Chat Agent',
    baseUrlEnvVar: 'INTEXURAOS_CHAT_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CHAT_AGENT_OPENAPI_URL',
    allowedOperations: [] as readonly string[],
  },
  {
    key: 'code-agent',
    name: 'Code Agent',
    baseUrlEnvVar: 'INTEXURAOS_CODE_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CODE_AGENT_OPENAPI_URL',
    allowedOperations: ['getTaskDispatchMetadata', 'getLinearIssueContext'] as readonly string[],
  },
  {
    key: 'linear-agent',
    name: 'Linear Agent',
    baseUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_OPENAPI_URL',
    allowedOperations: ['processLinearAction', 'validateIssue', 'generateIssueTitle', 'createIssueInternal', 'getLinearIssueInternal', 'updateIssueStateInternal'] as readonly string[],
  },
  {
    key: 'web-agent',
    name: 'Web Agent',
    baseUrlEnvVar: 'INTEXURAOS_WEB_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_WEB_AGENT_OPENAPI_URL',
    allowedOperations: ['fetchLinkPreviewsInternal', 'summarizePageInternal'] as readonly string[],
  },
  {
    key: 'cron-agent',
    name: 'Cron Agent',
    baseUrlEnvVar: 'INTEXURAOS_CRON_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CRON_AGENT_OPENAPI_URL',
    allowedOperations: [] as readonly string[],
  },
  {
    key: 'hellscript-agent',
    name: 'Hellscript Agent',
    baseUrlEnvVar: 'INTEXURAOS_HELLSCRIPT_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_HELLSCRIPT_AGENT_OPENAPI_URL',
    allowedOperations: [] as readonly string[],
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
        allowedOperations: [...entry.allowedOperations],
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
