import type { AppConfig } from '@/types';
import { WEB_SERVICE_URLS } from './config.generated';

type ServiceEnvVar = (typeof WEB_SERVICE_URLS)[number]['envVar'];

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

function getGeneratedServiceUrls(): Record<ServiceEnvVar, string> {
  return Object.fromEntries(
    WEB_SERVICE_URLS.map(({ envVar, apiPath }) => [envVar, getServiceUrl(envVar, apiPath)])
  ) as Record<ServiceEnvVar, string>;
}

export function getConfig(): AppConfig {
  const serviceUrls = getGeneratedServiceUrls();

  return {
    auth0Domain: getEnvVar('INTEXURAOS_AUTH0_DOMAIN'),
    auth0ClientId: getEnvVar('INTEXURAOS_AUTH0_SPA_CLIENT_ID'),
    authAudience: getEnvVar('INTEXURAOS_AUTH_AUDIENCE'),
    authServiceUrl: serviceUrls.INTEXURAOS_USER_SERVICE_URL,
    whatsappServiceUrl: serviceUrls.INTEXURAOS_WHATSAPP_SERVICE_URL,
    notionServiceUrl: serviceUrls.INTEXURAOS_NOTION_SERVICE_URL,
    mobileNotificationsServiceUrl: serviceUrls.INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL,
    fishingAssistantServiceUrl: serviceUrls.INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL,
    ResearchAgentUrl: serviceUrls.INTEXURAOS_RESEARCH_AGENT_URL,
    commandsAgentServiceUrl: serviceUrls.INTEXURAOS_COMMANDS_AGENT_URL,
    actionsAgentUrl: serviceUrls.INTEXURAOS_ACTIONS_AGENT_URL,
    notesAgentUrl: serviceUrls.INTEXURAOS_NOTES_AGENT_URL,
    bookmarksAgentUrl: serviceUrls.INTEXURAOS_BOOKMARKS_AGENT_URL,
    calendarAgentUrl: serviceUrls.INTEXURAOS_CALENDAR_AGENT_URL,
    linearAgentUrl: serviceUrls.INTEXURAOS_LINEAR_AGENT_URL,
    codeAgentUrl: serviceUrls.INTEXURAOS_CODE_AGENT_URL,
    hellscriptAgentUrl: serviceUrls.INTEXURAOS_HELLSCRIPT_AGENT_URL,
    appSettingsServiceUrl: serviceUrls.INTEXURAOS_APP_SETTINGS_SERVICE_URL,
    llmUsageServiceUrl: serviceUrls.INTEXURAOS_LLM_USAGE_SERVICE_URL,
    imageServiceUrl: serviceUrls.INTEXURAOS_IMAGE_SERVICE_URL,
    webAgentUrl: serviceUrls.INTEXURAOS_WEB_AGENT_URL,
    intexAgentUrl: serviceUrls.INTEXURAOS_INTEX_AGENT_URL,
    firebaseProjectId: getEnvVar('INTEXURAOS_FIREBASE_PROJECT_ID'),
    firebaseApiKey: getEnvVar('INTEXURAOS_FIREBASE_API_KEY'),
    firebaseAuthDomain: getEnvVar('INTEXURAOS_FIREBASE_AUTH_DOMAIN'),
    sentryDsn: getEnvVar('INTEXURAOS_SENTRY_DSN_WEB'),
  };
}

export const config = getConfig();
