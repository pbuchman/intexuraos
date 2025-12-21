/**
 * Configuration module for whatsapp-service.
 * Validates required environment variables using Zod.
 */
import { z } from 'zod';

/**
 * Schema for WhatsApp service configuration.
 * All values are sourced from environment variables.
 */
const configSchema = z.object({
  /**
   * Webhook verification token.
   * Used to verify webhook registration with Meta.
   */
  verifyToken: z.string().min(1, 'PRAXOS_WHATSAPP_VERIFY_TOKEN is required'),

  /**
   * App secret for webhook signature validation.
   * Used to compute HMAC-SHA256 signatures.
   */
  appSecret: z.string().min(1, 'PRAXOS_WHATSAPP_APP_SECRET is required'),

  /**
   * Allowed WhatsApp Business phone number IDs.
   * Comma-separated list of phone number IDs that this service will process.
   */
  allowedPhoneNumberIds: z
    .string()
    .min(1, 'PRAXOS_WHATSAPP_PHONE_NUMBER_ID is required')
    .transform((val) => val.split(',').map((id) => id.trim())),

  /**
   * Server port.
   */
  port: z.coerce.number().int().positive().default(8080),

  /**
   * Server host.
   */
  host: z.string().default('0.0.0.0'),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Load and validate configuration from environment variables.
 * Throws if required variables are missing or invalid.
 */
export function loadConfig(): Config {
  return configSchema.parse({
    verifyToken: process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'],
    appSecret: process.env['PRAXOS_WHATSAPP_APP_SECRET'],
    allowedPhoneNumberIds: process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'],
    port: process.env['PORT'],
    host: process.env['HOST'],
  });
}

/**
 * Validates that required config environment variables are present.
 * Returns list of missing variables.
 */
export function validateConfigEnv(): string[] {
  const required = [
    'PRAXOS_WHATSAPP_VERIFY_TOKEN',
    'PRAXOS_WHATSAPP_APP_SECRET',
    'PRAXOS_WHATSAPP_PHONE_NUMBER_ID',
  ];
  return required.filter((key) => process.env[key] === undefined || process.env[key] === '');
}
