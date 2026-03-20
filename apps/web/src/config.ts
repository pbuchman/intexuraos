import type { AppConfig } from '@/types';

function getEnvVar(key: string): string {
  const value = import.meta.env[key] as string | undefined;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getServiceUrl(envVar: string, apiPath: string): string {
  if (import.meta.env.DEV) {
    return apiPath;
  }
  return getEnvVar(envVar);
}

export function getConfig(): AppConfig {
  return {
    auth0Domain: getEnvVar('INTEXURAOS_AUTH0_DOMAIN'),
    auth0ClientId: getEnvVar('INTEXURAOS_AUTH0_SPA_CLIENT_ID'),
    authAudience: getEnvVar('INTEXURAOS_AUTH_AUDIENCE'),
    authServiceUrl: getServiceUrl('INTEXURAOS_USER_SERVICE_URL', '/api/user'),
    whatsappServiceUrl: getServiceUrl('INTEXURAOS_WHATSAPP_SERVICE_URL', '/api/whatsapp'),
    notionServiceUrl: getServiceUrl('INTEXURAOS_NOTION_SERVICE_URL', '/api/notion'),
    mobileNotificationsServiceUrl: getServiceUrl('INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL', '/api/notifications'),
    ResearchAgentUrl: getServiceUrl('INTEXURAOS_RESEARCH_AGENT_URL', '/api/research'),
    commandsAgentServiceUrl: getServiceUrl('INTEXURAOS_COMMANDS_AGENT_URL', '/api/commands'),
    actionsAgentUrl: getServiceUrl('INTEXURAOS_ACTIONS_AGENT_URL', '/api/actions'),
    dataInsightsAgentUrl: getServiceUrl('INTEXURAOS_DATA_INSIGHTS_AGENT_URL', '/api/data-insights'),
    notesAgentUrl: getServiceUrl('INTEXURAOS_NOTES_AGENT_URL', '/api/notes'),
    todosAgentUrl: getServiceUrl('INTEXURAOS_TODOS_AGENT_URL', '/api/todos'),
    bookmarksAgentUrl: getServiceUrl('INTEXURAOS_BOOKMARKS_AGENT_URL', '/api/bookmarks'),
    calendarAgentUrl: getServiceUrl('INTEXURAOS_CALENDAR_AGENT_URL', '/api/calendar'),
    linearAgentUrl: getServiceUrl('INTEXURAOS_LINEAR_AGENT_URL', '/api/linear'),
    codeAgentUrl: getServiceUrl('INTEXURAOS_CODE_AGENT_URL', '/api/code'),
    chatAgentUrl: getServiceUrl('INTEXURAOS_CHAT_AGENT_URL', '/api/chat'),
    cronAgentUrl: getServiceUrl('INTEXURAOS_CRON_AGENT_URL', '/api/cron-agent'),
    hellscriptAgentUrl: getServiceUrl('INTEXURAOS_HELLSCRIPT_AGENT_URL', '/api/hellscript-agent'),
    appSettingsServiceUrl: getServiceUrl('INTEXURAOS_APP_SETTINGS_SERVICE_URL', '/api/settings'),
    firebaseProjectId: getEnvVar('INTEXURAOS_FIREBASE_PROJECT_ID'),
    firebaseApiKey: getEnvVar('INTEXURAOS_FIREBASE_API_KEY'),
    firebaseAuthDomain: getEnvVar('INTEXURAOS_FIREBASE_AUTH_DOMAIN'),
    sentryDsn: getEnvVar('INTEXURAOS_SENTRY_DSN_WEB'),
  };
}

export const config = getConfig();
