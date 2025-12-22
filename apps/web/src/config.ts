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
    auth0Domain: getEnvVar('VITE_AUTH0_DOMAIN'),
    auth0ClientId: getEnvVar('VITE_AUTH0_CLIENT_ID'),
    authAudience: getEnvVar('VITE_AUTH_AUDIENCE'),
    authServiceUrl: getEnvVar('VITE_AUTH_SERVICE_URL'),
    promptVaultServiceUrl: getEnvVar('VITE_PROMPTVAULT_SERVICE_URL'),
    whatsappServiceUrl: getEnvVar('VITE_WHATSAPP_SERVICE_URL'),
  };
}

export const config = getConfig();
