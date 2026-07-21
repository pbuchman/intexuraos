/**
 * Configuration module for whatsapp-service.
 * Validates required environment variables using Zod.
 */
import {
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  isConversationAssistantModel,
} from '@intexuraos/llm-contract';
import { matrixCorpusSafeIdSchema } from '@intexuraos/http-contracts';
import { z } from 'zod';

type Environment = Readonly<Record<string, string | undefined>>;

export type WhatsAppMatrixCorpusConfig =
  | { enabled: false; runtimeAudience: 'disabled' }
  | {
      enabled: true;
      runtimeAudience: 'home-dev';
      evaluatorBindingHmacKey: string;
      configuredEvaluatorUserId: string;
      matrixRoomBinding: string;
      whatsappAccountBinding: string;
      whatsappSenderBinding: string;
      signingKeyVersion: string;
      signingKeyMaterial: string;
    };

const DISABLED_MATRIX_CORPUS_CONFIG = {
  enabled: false,
  runtimeAudience: 'disabled',
} as const;

const MATRIX_CORPUS_WHATSAPP_REQUIRED_ENV = [
  'INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME',
  'INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE',
  'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
  'INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING',
  'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING',
  'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING',
  'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
  'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY',
] as const;

/**
 * Schema for WhatsApp service configuration.
 * All values are sourced from environment variables.
 *
 * Webhook validation requires both WABA ID and Phone Number ID to match.
 * This ensures webhooks are only accepted from the configured business account.
 */
const configSchema = z.object({
  /**
   * Webhook verification token.
   * Used to verify webhook registration with Meta.
   */
  verifyToken: z.string().min(1, 'INTEXURAOS_WHATSAPP_VERIFY_TOKEN is required'),

  /**
   * App secret for webhook signature validation.
   * Used to compute HMAC-SHA256 signatures.
   */
  appSecret: z.string().min(1, 'INTEXURAOS_WHATSAPP_APP_SECRET is required'),

  /**
   * WhatsApp access token for sending messages via Graph API.
   * Used to authenticate API requests to send messages.
   */
  accessToken: z.string().min(1, 'INTEXURAOS_WHATSAPP_ACCESS_TOKEN is required'),

  /**
   * Allowed WhatsApp Business Account IDs (WABA IDs).
   * Comma-separated list. Webhooks are rejected if entry[].id doesn't match.
   * Find at: Business Settings → WhatsApp Business Accounts → Account ID
   */
  allowedWabaIds: z
    .string()
    .min(1, 'INTEXURAOS_WHATSAPP_WABA_ID is required')
    .transform((val) => val.split(',').map((id) => id.trim())),

  /**
   * Allowed WhatsApp Business phone number IDs.
   * Comma-separated list. Webhooks are rejected if metadata.phone_number_id doesn't match.
   * Find at: WhatsApp → API Setup → Phone Number ID
   */
  allowedPhoneNumberIds: z
    .string()
    .min(1, 'INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID is required')
    .transform((val) => val.split(',').map((id) => id.trim())),

  /**
   * GCS bucket name for WhatsApp media files.
   */
  mediaBucket: z.string().min(1, 'INTEXURAOS_WHATSAPP_MEDIA_BUCKET is required'),

  /**
   * Pub/Sub topic for media cleanup events.
   */
  mediaCleanupTopic: z.string().min(1, 'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC is required'),

  /**
   * Pub/Sub subscription for media cleanup events.
   * The cleanup worker subscribes to this to process cleanup events.
   */
  mediaCleanupSubscription: z
    .string()
    .min(1, 'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION is required'),

  /**
   * Pub/Sub topic for intex-agent WhatsApp Assistant message ingest events.
   * Required: Assistant conversations must reach intex-agent for realtime replies.
   */
  intexMessageIngestTopic: z
    .string()
    .min(1, 'INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC is required'),

  /**
   * Pub/Sub topic for stored audio events.
   * Required: voice messages must reach the transcription worker.
   */
  audioStoredTopic: z.string().min(1, 'INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC is required'),

  /**
   * Pub/Sub topic for send message events.
   * Other services publish to this topic to request outbound WhatsApp messages.
   * Note: Subscription is configured in Terraform as push to /internal/whatsapp/pubsub/send-message
   */
  sendMessageTopic: z.string().optional(),

  /**
   * Pub/Sub topic for webhook processing.
   * Decouples webhook response from async processing.
   */
  webhookProcessTopic: z.string().optional(),

  /**
   * GCP project ID.
   */
  gcpProjectId: z.string().min(1, 'INTEXURAOS_GCP_PROJECT_ID is required'),

  /**
   * Web-agent service URL for link preview extraction.
   */
  webAgentUrl: z.string().min(1, 'INTEXURAOS_WEB_AGENT_URL is required'),

  /**
   * Internal auth token for service-to-service communication.
   */
  internalAuthToken: z.string().min(1, 'INTEXURAOS_INTERNAL_AUTH_TOKEN is required'),

  /**
   * LLM usage service URL for Conversation Assistant usage reporting.
   */
  llmUsageServiceUrl: z.string().min(1, 'INTEXURAOS_LLM_USAGE_SERVICE_URL is required'),

  /**
   * User service URL for fetching per-user LLM API keys.
   */
  userServiceUrl: z.string().min(1, 'INTEXURAOS_USER_SERVICE_URL is required'),

  /**
   * OpenRouter model used for frozen WhatsApp Conversation Assistant sessions.
   */
  conversationAssistantModel: z
    .string()
    .min(1)
    .refine(isConversationAssistantModel, 'Unsupported Conversation Assistant model configured')
    .default(DEFAULT_CONVERSATION_ASSISTANT_MODEL),

  /**
   * Server port.
   */
  port: z.coerce.number().int().positive().default(8080),

  /**
   * Server host.
   */
  host: z.string().default('0.0.0.0'),
});

export type Config = z.infer<typeof configSchema> & {
  matrixCorpus: WhatsAppMatrixCorpusConfig;
};

/**
 * Parse the closed Home Dev-only Matrix corpus configuration.
 *
 * Error messages intentionally contain field names only. Configuration values include
 * private bindings and signing material and must never be reflected in startup output.
 */
export function parseWhatsAppMatrixCorpusConfig(
  env: Environment = process.env
): WhatsAppMatrixCorpusConfig {
  const enabled = parseEnableFlag(env['INTEXURAOS_MATRIX_CORPUS_ENABLED']);
  if (!enabled) return DISABLED_MATRIX_CORPUS_CONFIG;

  if (env['INTEXURAOS_ENVIRONMENT'] !== 'dev') {
    throw invalidConfig('INTEXURAOS_ENVIRONMENT');
  }
  if (env['INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME'] !== 'home-dev') {
    throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME');
  }
  if (env['INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE'] !== 'home-dev') {
    throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE');
  }

  const signingKeyVersion = requireCanonicalValue(
    env,
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
    64,
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
  );
  const signingKeyMaterial = requireCanonicalValue(
    env,
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY',
    4096
  );
  assertCanonicalEd25519Jwk(
    signingKeyMaterial,
    signingKeyVersion,
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY'
  );

  return {
    enabled: true,
    runtimeAudience: 'home-dev',
    evaluatorBindingHmacKey: requireCanonicalValue(
      env,
      'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
      4096,
      undefined,
      32
    ),
    configuredEvaluatorUserId: requireSafeId(
      env,
      'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'
    ),
    matrixRoomBinding: requireCanonicalValue(
      env,
      'INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING',
      512
    ),
    whatsappAccountBinding: requireCanonicalValue(
      env,
      'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING',
      512
    ),
    whatsappSenderBinding: requireCanonicalValue(
      env,
      'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING',
      512
    ),
    signingKeyVersion,
    signingKeyMaterial,
  };
}

/**
 * Load and validate configuration from environment variables.
 * Throws if required variables are missing or invalid.
 */
export function loadConfig(): Config {
  const conversationAssistantModelEnv =
    process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL']?.trim();

  const config = configSchema.parse({
    verifyToken: process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'],
    appSecret: process.env['INTEXURAOS_WHATSAPP_APP_SECRET'],
    accessToken: process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'],
    allowedWabaIds: process.env['INTEXURAOS_WHATSAPP_WABA_ID'],
    allowedPhoneNumberIds: process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'],
    mediaBucket: process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'],
    mediaCleanupTopic: process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC'],
    mediaCleanupSubscription: process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION'],
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'],
    webAgentUrl: process.env['INTEXURAOS_WEB_AGENT_URL'],
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
    llmUsageServiceUrl: process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'],
    userServiceUrl: process.env['INTEXURAOS_USER_SERVICE_URL'],
    conversationAssistantModel:
      conversationAssistantModelEnv === undefined || conversationAssistantModelEnv === ''
        ? undefined
        : conversationAssistantModelEnv,
    intexMessageIngestTopic: process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'],
    audioStoredTopic: process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'],
    sendMessageTopic: process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'],
    webhookProcessTopic: process.env['INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC'],
    port: process.env['PORT'],
    host: process.env['HOST'],
  });

  return {
    ...config,
    matrixCorpus: parseWhatsAppMatrixCorpusConfig(),
  };
}

/**
 * Validates that required config environment variables are present.
 * Returns list of missing variables.
 */
export function validateConfigEnv(): string[] {
  const required: string[] = [
    'INTEXURAOS_WHATSAPP_VERIFY_TOKEN',
    'INTEXURAOS_WHATSAPP_APP_SECRET',
    'INTEXURAOS_WHATSAPP_ACCESS_TOKEN',
    'INTEXURAOS_WHATSAPP_WABA_ID',
    'INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID',
    'INTEXURAOS_WHATSAPP_MEDIA_BUCKET',
    'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC',
    'INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION',
    'INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC',
    'INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC',
    'INTEXURAOS_GCP_PROJECT_ID',
    'INTEXURAOS_WEB_AGENT_URL',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_LLM_USAGE_SERVICE_URL',
    'INTEXURAOS_USER_SERVICE_URL',
    'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL',
    'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN',
  ];
  if (process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED']?.trim() === 'true') {
    required.push('INTEXURAOS_ENVIRONMENT', ...MATRIX_CORPUS_WHATSAPP_REQUIRED_ENV);
  }
  return required.filter((key) => process.env[key] === undefined || process.env[key] === '');
}

function parseEnableFlag(value: string | undefined): boolean {
  const normalized = value?.trim() ?? '';
  if (normalized === '' || normalized === 'false') return false;
  if (normalized === 'true') return true;
  throw invalidConfig('INTEXURAOS_MATRIX_CORPUS_ENABLED');
}

function requireCanonicalValue(
  env: Environment,
  name: string,
  maxLength: number,
  pattern?: RegExp,
  minLength = 1
): string {
  const value = env[name];
  if (
    value === undefined ||
    value.length < minLength ||
    value.length > maxLength ||
    value.trim() !== value ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw invalidConfig(name);
  }
  return value;
}

function requireSafeId(env: Environment, name: string): string {
  const value = requireCanonicalValue(env, name, 128);
  if (!matrixCorpusSafeIdSchema.safeParse(value).success) throw invalidConfig(name);
  return value;
}

function assertCanonicalEd25519Jwk(
  material: string,
  keyVersion: string,
  fieldName: string
): void {
  let candidate: unknown;
  try {
    candidate = JSON.parse(material);
  } catch {
    throw invalidConfig(fieldName);
  }
  if (!isPlainRecord(candidate)) throw invalidConfig(fieldName);

  const expectedKeys = ['crv', 'd', 'kid', 'kty', 'x'];
  const actualKeys = Object.keys(candidate).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    candidate['kty'] !== 'OKP' ||
    candidate['crv'] !== 'Ed25519' ||
    candidate['kid'] !== keyVersion ||
    !isCanonicalEd25519Component(candidate['x']) ||
    !isCanonicalEd25519Component(candidate['d'])
  ) {
    throw invalidConfig(fieldName);
  }
}

function isCanonicalEd25519Component(value: unknown): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidConfig(fieldName: string): Error {
  return new Error(`${fieldName} is invalid`);
}
