import type { AppConfig } from '@/types';

function getEnvVar(key: string): string {
  const value = import.meta.env[key] as string | undefined;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function getConfig(): AppConfig {
  return {
    auth0Domain: getEnvVar('INTEXURAOS_AUTH0_DOMAIN'),
    auth0ClientId: getEnvVar('INTEXURAOS_AUTH0_SPA_CLIENT_ID'),
    authAudience: getEnvVar('INTEXURAOS_AUTH_AUDIENCE'),
    authServiceUrl: getEnvVar('INTEXURAOS_USER_SERVICE_URL'),
    whatsappServiceUrl: getEnvVar('INTEXURAOS_WHATSAPP_SERVICE_URL'),
    notionServiceUrl: getEnvVar('INTEXURAOS_NOTION_SERVICE_URL'),
    mobileNotificationsServiceUrl: getEnvVar('INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'),
    ResearchAgentUrl: getEnvVar('INTEXURAOS_RESEARCH_AGENT_URL'),
    commandsAgentServiceUrl: getEnvVar('INTEXURAOS_COMMANDS_AGENT_URL'),
    actionsAgentUrl: getEnvVar('INTEXURAOS_ACTIONS_AGENT_URL'),
    dataInsightsAgentUrl: getEnvVar('INTEXURAOS_DATA_INSIGHTS_AGENT_URL'),
    notesAgentUrl: getEnvVar('INTEXURAOS_NOTES_AGENT_URL'),
    todosAgentUrl: getEnvVar('INTEXURAOS_TODOS_AGENT_URL'),
    bookmarksAgentUrl: getEnvVar('INTEXURAOS_BOOKMARKS_AGENT_URL'),
    calendarAgentUrl: getEnvVar('INTEXURAOS_CALENDAR_AGENT_URL'),
    linearAgentUrl: getEnvVar('INTEXURAOS_LINEAR_AGENT_URL'),
    appSettingsServiceUrl: getEnvVar('INTEXURAOS_APP_SETTINGS_SERVICE_URL'),
    firebaseProjectId: getEnvVar('INTEXURAOS_FIREBASE_PROJECT_ID'),
    firebaseApiKey: getEnvVar('INTEXURAOS_FIREBASE_API_KEY'),
    firebaseAuthDomain: getEnvVar('INTEXURAOS_FIREBASE_AUTH_DOMAIN'),
    sentryDsn: getEnvVar('INTEXURAOS_SENTRY_DSN_WEB'),
  };
}

export const config = getConfig();
