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
    promptVaultServiceUrl: getEnvVar('INTEXURAOS_PROMPTVAULT_SERVICE_URL'),
    whatsappServiceUrl: getEnvVar('INTEXURAOS_WHATSAPP_SERVICE_URL'),
    notionServiceUrl: getEnvVar('INTEXURAOS_NOTION_SERVICE_URL'),
    mobileNotificationsServiceUrl: getEnvVar('INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'),
    llmOrchestratorUrl: getEnvVar('INTEXURAOS_LLM_ORCHESTRATOR_URL'),
    commandsRouterServiceUrl: getEnvVar('INTEXURAOS_COMMANDS_ROUTER_SERVICE_URL'),
  };
}

export const config = getConfig();
