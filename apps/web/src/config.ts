import type { AppConfig } from '@/types';
import { WEB_SERVICE_URLS } from './config.generated';
import { readPublicWebEnv, type PublicWebEnvKey } from './publicEnv';

type ServiceEnvVar = (typeof WEB_SERVICE_URLS)[number]['envVar'];

const publicEnv = readPublicWebEnv();

function getEnvVar(key: PublicWebEnvKey): string {
  const value = publicEnv[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getGeneratedServiceUrls(): Record<ServiceEnvVar, string> {
  return Object.fromEntries(
    WEB_SERVICE_URLS.map(({ envVar, apiPath }) => [envVar, apiPath])
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
    messageDigestServiceUrl: serviceUrls.INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL,
    fishingAssistantServiceUrl: serviceUrls.INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL,
    ResearchAgentUrl: serviceUrls.INTEXURAOS_RESEARCH_AGENT_URL,
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
