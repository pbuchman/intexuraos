/**
 * Configuration module for data-insights-service.
 * Validates required environment variables using Zod.
 */
import { z } from 'zod';

/**
 * Schema for data insights service configuration.
 * All values are sourced from environment variables.
 */
const configSchema = z.object({
  /**
   * Server port.
   */
  port: z.coerce.number().int().positive().default(8080),

  /**
   * Server host.
   */
  host: z.string().default('0.0.0.0'),

  /**
   * Internal auth token for service-to-service communication.
   */
  internalAuthToken: z.string().optional().default(''),

  /**
   * URL for user-service to fetch user's LLM API keys.
   */
  userServiceUrl: z.string().url().optional().default('http://localhost:8110'),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Load and validate configuration from environment variables.
 * Throws if required variables are missing or invalid.
 */
export function loadConfig(): Config {
  return configSchema.parse({
    port: process.env['PORT'],
    host: process.env['HOST'],
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
    userServiceUrl: process.env['USER_SERVICE_URL'],
  });
}

/**
 * Required environment variables for health check.
 * Auth config is validated by the auth plugin.
 */
const REQUIRED_ENV_VARS = [
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
];

/**
 * Validates that required config environment variables are present.
 * Returns list of missing variables.
 */
export function validateConfigEnv(): string[] {
  return REQUIRED_ENV_VARS.filter(
    (key) => process.env[key] === undefined || process.env[key] === ''
  );
}
