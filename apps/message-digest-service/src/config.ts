export const REQUIRED_MESSAGE_DIGEST_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_DIGEST_LLM_MODEL',
  'INTEXURAOS_PUBSUB_MESSAGE_DIGEST_RUN_TOPIC',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_WEB_APP_URL',
] as const;

const LOCAL_MVP_PROJECT_ID = 'intexuraos-message-digest-mvp-local';

export interface Config {
  port: number;
  gcpProjectId: string;
  firestoreProjectId: string;
  pubsubProjectId: string;
  storageMode: 'emulator' | 'persistent';
  firestoreEmulatorHost?: string | undefined;
  pubsubEmulatorHost?: string | undefined;
  authJwksUrl: string;
  authIssuer: string;
  authAudience: string;
  internalAuthToken: string;
  whatsappServiceUrl: string;
  llmUsageServiceUrl: string;
  openRouterAppApiKey: string;
  digestLlmModel: string;
  messageDigestRunTopic: string;
  whatsappSendTopic: string;
  webAppUrl: string;
  sentryDsn?: string | undefined;
  environment: string;
  runtime: string;
}

export function validateMessageDigestConfigEnv(
  environment: NodeJS.ProcessEnv = process.env
): string[] {
  return REQUIRED_MESSAGE_DIGEST_ENV.filter((name) => isBlank(environment[name]));
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const missing = validateMessageDigestConfigEnv(environment);
  if (missing.length > 0) {
    throw new Error(
      `Missing required message-digest-service environment variables: ${missing.join(', ')}`
    );
  }

  const runtime = optional(environment, 'INTEXURAOS_RUNTIME') ?? 'dev';
  const firestoreEmulatorHost = optional(environment, 'FIRESTORE_EMULATOR_HOST');
  const pubsubEmulatorHost = optional(environment, 'PUBSUB_EMULATOR_HOST');
  const isLocalMvpRuntime = runtime === 'dev' || runtime === 'development' || runtime === 'local';

  if (
    isLocalMvpRuntime &&
    (firestoreEmulatorHost === undefined || pubsubEmulatorHost === undefined)
  ) {
    throw new Error(
      'Local message-digest-service requires both FIRESTORE_EMULATOR_HOST and PUBSUB_EMULATOR_HOST'
    );
  }
  if (
    runtime === 'prod' &&
    (firestoreEmulatorHost !== undefined || pubsubEmulatorHost !== undefined)
  ) {
    throw new Error('Production message-digest-service cannot use Firestore or Pub/Sub emulators');
  }
  if (
    !isLocalMvpRuntime &&
    runtime !== 'prod' &&
    (firestoreEmulatorHost === undefined) !== (pubsubEmulatorHost === undefined)
  ) {
    throw new Error(
      'Message Digest emulator storage requires both FIRESTORE_EMULATOR_HOST and PUBSUB_EMULATOR_HOST'
    );
  }

  const gcpProjectId = required(environment, 'INTEXURAOS_GCP_PROJECT_ID');
  const storageMode =
    firestoreEmulatorHost !== undefined && pubsubEmulatorHost !== undefined
      ? ('emulator' as const)
      : ('persistent' as const);
  const isolatedProjectId = storageMode === 'emulator' ? LOCAL_MVP_PROJECT_ID : gcpProjectId;
  const port = parsePort(environment['PORT']);

  return {
    port,
    gcpProjectId,
    firestoreProjectId: isolatedProjectId,
    pubsubProjectId: isolatedProjectId,
    storageMode,
    ...(firestoreEmulatorHost === undefined ? {} : { firestoreEmulatorHost }),
    ...(pubsubEmulatorHost === undefined ? {} : { pubsubEmulatorHost }),
    authJwksUrl: required(environment, 'INTEXURAOS_AUTH_JWKS_URL'),
    authIssuer: required(environment, 'INTEXURAOS_AUTH_ISSUER'),
    authAudience: required(environment, 'INTEXURAOS_AUTH_AUDIENCE'),
    internalAuthToken: required(environment, 'INTEXURAOS_INTERNAL_AUTH_TOKEN'),
    whatsappServiceUrl: required(environment, 'INTEXURAOS_WHATSAPP_SERVICE_URL'),
    llmUsageServiceUrl: required(environment, 'INTEXURAOS_LLM_USAGE_SERVICE_URL'),
    openRouterAppApiKey: required(environment, 'INTEXURAOS_OPENROUTER_APP_API_KEY'),
    digestLlmModel: required(environment, 'INTEXURAOS_DIGEST_LLM_MODEL'),
    messageDigestRunTopic: required(environment, 'INTEXURAOS_PUBSUB_MESSAGE_DIGEST_RUN_TOPIC'),
    whatsappSendTopic: required(environment, 'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'),
    webAppUrl: required(environment, 'INTEXURAOS_WEB_APP_URL'),
    ...(optional(environment, 'INTEXURAOS_SENTRY_DSN') === undefined
      ? {}
      : { sentryDsn: optional(environment, 'INTEXURAOS_SENTRY_DSN') }),
    environment: optional(environment, 'INTEXURAOS_ENVIRONMENT') ?? 'development',
    runtime,
  };
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 8135;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid message-digest-service PORT');
  }
  return port;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined) {
    throw new Error(
      `Required message-digest-service environment variable became unavailable: ${name}`
    );
  }
  return value.trim();
}

function optional(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}
