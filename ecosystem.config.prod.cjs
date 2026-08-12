/**
 * PM2 Ecosystem Configuration for Hetzner production.
 *
 * Usage:
 *   INTEXURAOS_ENVIRONMENT=prod pm2 start ecosystem.config.prod.cjs
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILE = process.env.INTEXURAOS_PROD_ENV_FILE ?? '/etc/intexuraos/.env.prod';
const ENV_FILE_VALUES = fs.existsSync(ENV_FILE)
  ? dotenv.parse(fs.readFileSync(ENV_FILE, 'utf8'))
  : {};
const RUNTIME_ENV = {
  ...process.env,
  ...ENV_FILE_VALUES,
  ...(process.env.INTEXURAOS_COMMIT_SHA === undefined
    ? {}
    : { INTEXURAOS_COMMIT_SHA: process.env.INTEXURAOS_COMMIT_SHA }),
};

function envValue(key) {
  return RUNTIME_ENV[key];
}

if (envValue('INTEXURAOS_ENVIRONMENT') !== 'prod') {
  throw new Error('Refusing to start PM2 without INTEXURAOS_ENVIRONMENT=prod');
}
if (
  envValue('INTEXURAOS_COMMIT_SHA') !== undefined &&
  !/^[0-9a-f]{40}$/.test(envValue('INTEXURAOS_COMMIT_SHA'))
) {
  throw new Error('INTEXURAOS_COMMIT_SHA must be a 40-character lowercase hexadecimal SHA');
}

const REPO_ROOT = __dirname;
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const WAIT_SCRIPT = path.resolve(REPO_ROOT, 'scripts/pm2-wait-start.mjs');
const PUBLIC_ORIGIN = envValue('INTEXURAOS_PUBLIC_ORIGIN') ?? 'https://intexuraos.cloud';
const GOOGLE_APPLICATION_CREDENTIALS =
  envValue('GOOGLE_APPLICATION_CREDENTIALS') ?? '/home/deploy/runtime-sa-key.json';
const PROJECT_ID = envValue('INTEXURAOS_GCP_PROJECT_ID') ?? 'intexuraos-dev-pbuchman';
const RETAINED_GCP_ENVIRONMENT = 'dev';

const SERVICE_PORTS = {
  'user-service': 8110,
  'notion-service': 8112,
  'whatsapp-service': 8113,
  'mobile-notifications-service': 8114,
  'fishing-assistant-service': 8119,
  'research-agent': 8116,
  'image-service': 8120,
  'notes-agent': 8121,
  'app-settings-service': 8122,
  'bookmarks-agent': 8124,
  'calendar-agent': 8125,
  'linear-agent': 8126,
  'web-agent': 8127,
  'code-agent': 8128,
  'hellscript-agent': 8131,
  'llm-usage-service': 8132,
  'api-docs-hub': 8133,
  'intex-agent': 8134,
  'message-digest-service': 8135,
};

const SERVICE_URL_ENV = {
  'user-service': 'INTEXURAOS_USER_SERVICE_URL',
  'notion-service': 'INTEXURAOS_NOTION_SERVICE_URL',
  'whatsapp-service': 'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'mobile-notifications-service': 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
  'fishing-assistant-service': 'INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL',
  'research-agent': 'INTEXURAOS_RESEARCH_AGENT_URL',
  'image-service': 'INTEXURAOS_IMAGE_SERVICE_URL',
  'notes-agent': 'INTEXURAOS_NOTES_AGENT_URL',
  'app-settings-service': 'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
  'bookmarks-agent': 'INTEXURAOS_BOOKMARKS_AGENT_URL',
  'calendar-agent': 'INTEXURAOS_CALENDAR_AGENT_URL',
  'linear-agent': 'INTEXURAOS_LINEAR_AGENT_URL',
  'web-agent': 'INTEXURAOS_WEB_AGENT_URL',
  'code-agent': 'INTEXURAOS_CODE_AGENT_URL',
  'hellscript-agent': 'INTEXURAOS_HELLSCRIPT_AGENT_URL',
  'llm-usage-service': 'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'api-docs-hub': 'INTEXURAOS_API_DOCS_HUB_URL',
  'intex-agent': 'INTEXURAOS_INTEX_AGENT_URL',
  'message-digest-service': 'INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL',
};

const PUBLIC_API_PATHS = {
  'user-service': '/api/user',
  'whatsapp-service': '/api/whatsapp',
  'notion-service': '/api/notion',
  'mobile-notifications-service': '/api/notifications',
  'fishing-assistant-service': '/api/fishing-assistant',
  'research-agent': '/api/research',
  'notes-agent': '/api/notes',
  'bookmarks-agent': '/api/bookmarks',
  'calendar-agent': '/api/calendar',
  'linear-agent': '/api/linear',
  'code-agent': '/api/code',
  'image-service': '/api/images',
  'web-agent': '/api/web',
  'app-settings-service': '/api/settings',
  'hellscript-agent': '/api/hellscript-agent',
  'llm-usage-service': '/api/llm-usage',
  'intex-agent': '/api/intex-agent',
  'message-digest-service': '/api/message-digests',
};

const API_DOCS_HUB_OPENAPI_URLS = {
  INTEXURAOS_USER_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8110/openapi.json',
  INTEXURAOS_NOTION_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8112/openapi.json',
  INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8113/openapi.json',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8114/openapi.json',
  INTEXURAOS_FISHING_ASSISTANT_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8119/openapi.json',
  INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL: 'http://127.0.0.1:8116/openapi.json',
  INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8120/openapi.json',
  INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8122/openapi.json',
  INTEXURAOS_NOTES_AGENT_OPENAPI_URL: 'http://127.0.0.1:8121/openapi.json',
  INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL: 'http://127.0.0.1:8124/openapi.json',
  INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL: 'http://127.0.0.1:8125/openapi.json',
  INTEXURAOS_CODE_AGENT_OPENAPI_URL: 'http://127.0.0.1:8128/openapi.json',
  INTEXURAOS_LINEAR_AGENT_OPENAPI_URL: 'http://127.0.0.1:8126/openapi.json',
  INTEXURAOS_WEB_AGENT_OPENAPI_URL: 'http://127.0.0.1:8127/openapi.json',
  INTEXURAOS_HELLSCRIPT_AGENT_OPENAPI_URL: 'http://127.0.0.1:8131/openapi.json',
  INTEXURAOS_INTEX_AGENT_OPENAPI_URL: 'http://127.0.0.1:8134/openapi.json',
  INTEXURAOS_MESSAGE_DIGEST_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8135/openapi.json',
};

const PROD_SERVICE_ORDER = [
  'app-settings-service',
  'notion-service',
  'whatsapp-service',
  'mobile-notifications-service',
  'fishing-assistant-service',
  'notes-agent',
  'bookmarks-agent',
  'code-agent',
  'hellscript-agent',
  'llm-usage-service',
  'intex-agent',
  'message-digest-service',
  'user-service',
  'research-agent',
  'image-service',
  'calendar-agent',
  'linear-agent',
  'web-agent',
  'api-docs-hub',
];

const APP_SETTINGS_DEPENDENT_SERVICES = new Set([
  'user-service',
  'research-agent',
  'image-service',
  'calendar-agent',
  'linear-agent',
  'web-agent',
]);

function topic(name) {
  return `intexuraos-${name}-${RETAINED_GCP_ENVIRONMENT}`;
}

function localServiceUrls() {
  return Object.fromEntries(
    Object.entries(SERVICE_URL_ENV).map(([service, envVar]) => [
      envVar,
      `http://127.0.0.1:${SERVICE_PORTS[service]}`,
    ])
  );
}

function publicServiceUrl(service) {
  const apiPath = PUBLIC_API_PATHS[service];
  return apiPath === undefined ? PUBLIC_ORIGIN : `${PUBLIC_ORIGIN}${apiPath}`;
}

function pickEnv(keys) {
  return Object.fromEntries(
    keys
      .map((key) => [key, envValue(key)])
      .filter(([, value]) => value !== undefined && value !== '')
  );
}

const COMMON_ENV_KEYS = [
  'GOOGLE_CLOUD_PROJECT',
  'PROJECT_ID',
  'REGION',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_PUBLIC_ORIGIN',
  'INTEXURAOS_SENTRY_DSN',
];

// Source-agnostic runtime names: /etc/intexuraos/.env.prod already contains the
// validated merge of tracked configuration and actual Secret Manager values.
const SERVICE_RUNTIME_ENV_KEYS = {
  'app-settings-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'notion-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'whatsapp-service': [
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
    'INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY',
    'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING',
    'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING',
    'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN',
    'INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL',
    'INTEXURAOS_WHATSAPP_ACCESS_TOKEN',
    'INTEXURAOS_WHATSAPP_APP_SECRET',
    'INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID',
    'INTEXURAOS_WHATSAPP_VERIFY_TOKEN',
    'INTEXURAOS_WHATSAPP_WABA_ID',
  ],
  'mobile-notifications-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'fishing-assistant-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_OPENAI_APP_API_KEY'],
  'notes-agent': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'bookmarks-agent': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'code-agent': [
    'INTEXURAOS_GITHUB_WEBHOOK_SECRET',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_OPENAI_APP_API_KEY',
    'INTEXURAOS_OPENROUTER_APP_API_KEY',
    'INTEXURAOS_ORCHESTRATOR_SECRET',
    'INTEXURAOS_SENTRY_WEBHOOK_SECRET',
    'INTEXURAOS_SENTRY_AUTOMATION_USER_ID',
    'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
    'INTEXURAOS_WEBHOOK_VERIFY_SECRET',
  ],
  'hellscript-agent': ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_OPENROUTER_APP_API_KEY'],
  'llm-usage-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_ORCHESTRATOR_SECRET'],
  'intex-agent': [
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY',
    'INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PUBLIC_KEY',
    'INTEXURAOS_OPENROUTER_APP_API_KEY',
  ],
  'message-digest-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_OPENROUTER_APP_API_KEY'],
  'user-service': [
    'INTEXURAOS_AUTH0_CLIENT_ID',
    'INTEXURAOS_AUTH0_DOMAIN',
    'INTEXURAOS_ENCRYPTION_KEY',
    'INTEXURAOS_GITHUB_OAUTH_CLIENT_ID',
    'INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET',
    'INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID',
    'INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
    'INTEXURAOS_OPENROUTER_APP_API_KEY',
    'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
  ],
  'research-agent': ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_OPENROUTER_APP_API_KEY'],
  'image-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'calendar-agent': ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_OPENROUTER_APP_API_KEY'],
  'linear-agent': ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_OPENROUTER_APP_API_KEY'],
  'web-agent': [
    'INTEXURAOS_CLOUDFLARE_ACCOUNT_ID',
    'INTEXURAOS_CLOUDFLARE_API_TOKEN',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_OPENROUTER_APP_API_KEY',
  ],
};

const COMMON_SERVICE_ENV = {
  HOME: envValue('HOME') ?? '/home/deploy',
  PATH: envValue('PATH'),
  ...pickEnv(COMMON_ENV_KEYS),
  GOOGLE_APPLICATION_CREDENTIALS,
  GOOGLE_CLOUD_QUOTA_PROJECT: PROJECT_ID,
  INTEXURAOS_GCP_PROJECT_ID: PROJECT_ID,
  INTEXURAOS_ENVIRONMENT: 'prod',
  INTEXURAOS_RUNTIME: 'prod',
  ...(envValue('INTEXURAOS_COMMIT_SHA') === undefined
    ? {}
    : { INTEXURAOS_COMMIT_SHA: envValue('INTEXURAOS_COMMIT_SHA') }),
  INTEXURAOS_WEB_APP_URL: envValue('INTEXURAOS_WEB_APP_URL') ?? PUBLIC_ORIGIN,
  INTEXURAOS_WEB_URL: envValue('INTEXURAOS_WEB_URL') ?? PUBLIC_ORIGIN,
  INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS:
    envValue('INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS') ??
    'or:google/gemma-4-31b-it,or:minimax/minimax-m3',
  ...localServiceUrls(),
};

const SERVICE_ENV_MAPPINGS = {
  'user-service': {
    INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID: envValue(
      'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'
    ),
    INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED: 'true',
    INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'hetzner-prod',
    INTEXURAOS_WEB_APP_URL: envValue('INTEXURAOS_WEB_APP_URL') ?? PUBLIC_ORIGIN,
  },
  'whatsapp-service': {
    INTEXURAOS_MATRIX_CORPUS_ENABLED: 'true',
    INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME: 'hetzner-prod',
    INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'hetzner-prod',
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET:
      envValue('INTEXURAOS_WHATSAPP_MEDIA_BUCKET') ??
      `intexuraos-whatsapp-media-${RETAINED_GCP_ENVIRONMENT}`,
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC:
      envValue('INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC') ?? topic('whatsapp-media-cleanup'),
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION:
      envValue('INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION') ??
      `${topic('whatsapp-media-cleanup')}-push`,
    INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC:
      envValue('INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC') ?? topic('audio-stored'),
    INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC:
      envValue('INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC') ?? topic('intex-message-ingest'),
    INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC:
      envValue('INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC') ?? topic('whatsapp-webhook-process'),
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      envValue('INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC') ?? topic('whatsapp-send'),
    INTEXURAOS_CONVERSATION_ASSISTANT_MODEL:
      envValue('INTEXURAOS_CONVERSATION_ASSISTANT_MODEL') ?? 'or:minimax/minimax-m3',
  },
  'research-agent': {
    INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC:
      envValue('INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC') ?? topic('research-process'),
    INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC:
      envValue('INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC') ?? topic('llm-analytics'),
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      envValue('INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC') ?? topic('whatsapp-send'),
    INTEXURAOS_PUBSUB_LLM_CALL_TOPIC:
      envValue('INTEXURAOS_PUBSUB_LLM_CALL_TOPIC') ?? topic('llm-call'),
    INTEXURAOS_WEB_APP_URL: envValue('INTEXURAOS_WEB_APP_URL') ?? PUBLIC_ORIGIN,
    INTEXURAOS_SHARED_CONTENT_BUCKET:
      envValue('INTEXURAOS_SHARED_CONTENT_BUCKET') ??
      `intexuraos-shared-content-${RETAINED_GCP_ENVIRONMENT}`,
    INTEXURAOS_SHARE_BASE_URL:
      envValue('INTEXURAOS_SHARE_BASE_URL') ?? `${PUBLIC_ORIGIN}/share/research`,
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL: envValue('INTEXURAOS_IMAGE_PUBLIC_BASE_URL') ?? PUBLIC_ORIGIN,
  },
  'image-service': {
    INTEXURAOS_IMAGE_BUCKET:
      envValue('INTEXURAOS_IMAGE_BUCKET') ?? `intexuraos-images-${RETAINED_GCP_ENVIRONMENT}`,
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL: envValue('INTEXURAOS_IMAGE_PUBLIC_BASE_URL') ?? PUBLIC_ORIGIN,
  },
  'bookmarks-agent': {
    INTEXURAOS_PUBSUB_BOOKMARK_ENRICH:
      envValue('INTEXURAOS_PUBSUB_BOOKMARK_ENRICH') ?? topic('bookmark-enrich'),
    INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE:
      envValue('INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE') ?? topic('bookmark-summarize'),
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      envValue('INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC') ?? topic('whatsapp-send'),
  },
  'code-agent': {
    INTEXURAOS_SERVICE_URL: envValue('INTEXURAOS_SERVICE_URL') ?? publicServiceUrl('code-agent'),
    INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL:
      envValue('INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL') ?? `${PUBLIC_ORIGIN}/api/code`,
    INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY:
      envValue('INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY') ?? 'pbuchman/intexuraos',
    INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH:
      envValue('INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH') ?? 'development',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      envValue('INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC') ?? topic('whatsapp-send'),
    INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC:
      envValue('INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC') ?? topic('pr-triage'),
    INTEXURAOS_EXECUTION_MEMORY_ENABLED: envValue('INTEXURAOS_EXECUTION_MEMORY_ENABLED') ?? 'true',
    INTEXURAOS_QUEUE_MAX_SIZE: envValue('INTEXURAOS_QUEUE_MAX_SIZE') ?? '50',
    INTEXURAOS_QUEUE_TTL_MINUTES: envValue('INTEXURAOS_QUEUE_TTL_MINUTES') ?? '1440',
    INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS: envValue('INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS') ?? '3',
    INTEXURAOS_RETRY_QUEUE_TTL_MINUTES: envValue('INTEXURAOS_RETRY_QUEUE_TTL_MINUTES') ?? '10',
    INTEXURAOS_AUTO_RETRY_MAX_ATTEMPTS: envValue('INTEXURAOS_AUTO_RETRY_MAX_ATTEMPTS') ?? '3',
    INTEXURAOS_ENABLE_METRICS: envValue('INTEXURAOS_ENABLE_METRICS') ?? 'true',
  },
  'linear-agent': {
    INTEXURAOS_SERVICE_URL: publicServiceUrl('linear-agent'),
  },
  'llm-usage-service': {
    INTEXURAOS_SERVICE_URL:
      envValue('INTEXURAOS_LLM_USAGE_PUBLIC_URL') ?? publicServiceUrl('llm-usage-service'),
  },
  'intex-agent': {
    INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED: 'true',
    INTEXURAOS_MATRIX_CORPUS_ENABLED: 'true',
    INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME: 'hetzner-prod',
    INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'hetzner-prod',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      envValue('INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC') ?? topic('whatsapp-send'),
    INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS:
      envValue('INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS') ?? '1800000',
  },
  'message-digest-service': {
    INTEXURAOS_DIGEST_LLM_MODEL:
      envValue('INTEXURAOS_DIGEST_LLM_MODEL') ?? 'or:google/gemini-3-flash-preview',
    INTEXURAOS_PUBSUB_MESSAGE_DIGEST_RUN_TOPIC:
      envValue('INTEXURAOS_PUBSUB_MESSAGE_DIGEST_RUN_TOPIC') ?? topic('message-digest-runs'),
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      envValue('INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC') ?? topic('whatsapp-send'),
    INTEXURAOS_WEB_APP_URL: envValue('INTEXURAOS_WEB_APP_URL') ?? PUBLIC_ORIGIN,
  },
  'api-docs-hub': {
    ...API_DOCS_HUB_OPENAPI_URLS,
  },
};

function createServiceConfig(name) {
  const waitForService = APP_SETTINGS_DEPENDENT_SERVICES.has(name)
    ? 'http://127.0.0.1:8122/health'
    : undefined;

  return {
    name,
    cwd: path.join(REPO_ROOT, 'apps', name),
    script: TSX_CLI,
    args: waitForService === undefined ? ['src/index.ts'] : [WAIT_SCRIPT, 'src/index.ts'],
    interpreter: 'node',
    env: {
      ...COMMON_SERVICE_ENV,
      ...pickEnv(SERVICE_RUNTIME_ENV_KEYS[name] ?? []),
      ...(SERVICE_ENV_MAPPINGS[name] ?? {}),
      ...(waitForService === undefined ? {} : { WAIT_FOR_SERVICE: waitForService }),
      PORT: String(SERVICE_PORTS[name]),
      NODE_ENV: 'production',
    },
    autorestart: true,
    kill_timeout: 5000,
    restart_delay: 5000,
    watch: false,
    filter_env: [
      'INTEXURAOS_',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'GOOGLE_CLOUD_QUOTA_PROJECT',
      'HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS',
      'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
      'GOOGLE_CLOUD_PROJECT',
      'PROJECT_ID',
      'REGION',
      'PUBSUB_EMULATOR_HOST',
      'FIRESTORE_EMULATOR_HOST',
      'STORAGE_EMULATOR_HOST',
    ],
    max_memory_restart: envValue('INTEXURAOS_PM2_MAX_MEMORY_RESTART') ?? '750M',
  };
}

module.exports = {
  apps: PROD_SERVICE_ORDER.map(createServiceConfig),
};
