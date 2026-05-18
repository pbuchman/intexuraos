/**
 * PM2 Ecosystem Configuration for Hetzner production.
 *
 * Usage:
 *   INTEXURAOS_ENVIRONMENT=prod pm2 start ecosystem.config.prod.cjs
 */
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILE = process.env.INTEXURAOS_PROD_ENV_FILE ?? '/etc/intexuraos/.env.prod';
dotenv.config({ path: ENV_FILE, quiet: true });

if (process.env.INTEXURAOS_ENVIRONMENT !== 'prod') {
  throw new Error('Refusing to start PM2 without INTEXURAOS_ENVIRONMENT=prod');
}

const REPO_ROOT = __dirname;
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const WAIT_SCRIPT = path.resolve(REPO_ROOT, 'scripts/pm2-wait-start.mjs');
const PUBLIC_ORIGIN = process.env.INTEXURAOS_PUBLIC_ORIGIN ?? 'https://intexuraos.cloud';
const GOOGLE_APPLICATION_CREDENTIALS =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '/home/deploy/sa-key.json';
const PROJECT_ID = process.env.INTEXURAOS_GCP_PROJECT_ID ?? 'intexuraos-dev-pbuchman';
const RETAINED_GCP_ENVIRONMENT = 'dev';

const SERVICE_PORTS = {
  'user-service': 8110,
  'notion-service': 8112,
  'whatsapp-service': 8113,
  'mobile-notifications-service': 8114,
  'fishing-assistant-service': 8119,
  'research-agent': 8116,
  'commands-agent': 8117,
  'actions-agent': 8118,
  'image-service': 8120,
  'notes-agent': 8121,
  'app-settings-service': 8122,
  'todos-agent': 8123,
  'bookmarks-agent': 8124,
  'calendar-agent': 8125,
  'linear-agent': 8126,
  'web-agent': 8127,
  'code-agent': 8128,
  'chat-agent': 8129,
  'cron-agent': 8130,
  'hellscript-agent': 8131,
  'llm-usage-service': 8132,
  'api-docs-hub': 8133,
};

const SERVICE_URL_ENV = {
  'user-service': 'INTEXURAOS_USER_SERVICE_URL',
  'notion-service': 'INTEXURAOS_NOTION_SERVICE_URL',
  'whatsapp-service': 'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'mobile-notifications-service': 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
  'fishing-assistant-service': 'INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL',
  'research-agent': 'INTEXURAOS_RESEARCH_AGENT_URL',
  'commands-agent': 'INTEXURAOS_COMMANDS_AGENT_URL',
  'actions-agent': 'INTEXURAOS_ACTIONS_AGENT_URL',
  'image-service': 'INTEXURAOS_IMAGE_SERVICE_URL',
  'notes-agent': 'INTEXURAOS_NOTES_AGENT_URL',
  'app-settings-service': 'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
  'todos-agent': 'INTEXURAOS_TODOS_AGENT_URL',
  'bookmarks-agent': 'INTEXURAOS_BOOKMARKS_AGENT_URL',
  'calendar-agent': 'INTEXURAOS_CALENDAR_AGENT_URL',
  'linear-agent': 'INTEXURAOS_LINEAR_AGENT_URL',
  'web-agent': 'INTEXURAOS_WEB_AGENT_URL',
  'code-agent': 'INTEXURAOS_CODE_AGENT_URL',
  'chat-agent': 'INTEXURAOS_CHAT_AGENT_URL',
  'cron-agent': 'INTEXURAOS_CRON_AGENT_URL',
  'hellscript-agent': 'INTEXURAOS_HELLSCRIPT_AGENT_URL',
  'llm-usage-service': 'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'api-docs-hub': 'INTEXURAOS_API_DOCS_HUB_URL',
};

const PUBLIC_API_PATHS = {
  'user-service': '/api/user',
  'whatsapp-service': '/api/whatsapp',
  'notion-service': '/api/notion',
  'mobile-notifications-service': '/api/notifications',
  'fishing-assistant-service': '/api/fishing-assistant',
  'research-agent': '/api/research',
  'commands-agent': '/api/commands',
  'actions-agent': '/api/actions',
  'notes-agent': '/api/notes',
  'todos-agent': '/api/todos',
  'bookmarks-agent': '/api/bookmarks',
  'calendar-agent': '/api/calendar',
  'chat-agent': '/api/chat',
  'linear-agent': '/api/linear',
  'code-agent': '/api/code',
  'image-service': '/api/images',
  'web-agent': '/api/web',
  'app-settings-service': '/api/settings',
  'cron-agent': '/api/cron-agent',
  'hellscript-agent': '/api/hellscript-agent',
  'llm-usage-service': '/api/llm-usage',
};

const API_DOCS_HUB_OPENAPI_URLS = {
  INTEXURAOS_USER_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8110/openapi.json',
  INTEXURAOS_NOTION_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8112/openapi.json',
  INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8113/openapi.json',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8114/openapi.json',
  INTEXURAOS_FISHING_ASSISTANT_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8119/openapi.json',
  INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL: 'http://127.0.0.1:8116/openapi.json',
  INTEXURAOS_COMMANDS_AGENT_OPENAPI_URL: 'http://127.0.0.1:8117/openapi.json',
  INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL: 'http://127.0.0.1:8118/openapi.json',
  INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8120/openapi.json',
  INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL: 'http://127.0.0.1:8122/openapi.json',
  INTEXURAOS_NOTES_AGENT_OPENAPI_URL: 'http://127.0.0.1:8121/openapi.json',
  INTEXURAOS_TODOS_AGENT_OPENAPI_URL: 'http://127.0.0.1:8123/openapi.json',
  INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL: 'http://127.0.0.1:8124/openapi.json',
  INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL: 'http://127.0.0.1:8125/openapi.json',
  INTEXURAOS_CHAT_AGENT_OPENAPI_URL: 'http://127.0.0.1:8129/openapi.json',
  INTEXURAOS_CODE_AGENT_OPENAPI_URL: 'http://127.0.0.1:8128/openapi.json',
  INTEXURAOS_LINEAR_AGENT_OPENAPI_URL: 'http://127.0.0.1:8126/openapi.json',
  INTEXURAOS_WEB_AGENT_OPENAPI_URL: 'http://127.0.0.1:8127/openapi.json',
  INTEXURAOS_CRON_AGENT_OPENAPI_URL: 'http://127.0.0.1:8130/openapi.json',
  INTEXURAOS_HELLSCRIPT_AGENT_OPENAPI_URL: 'http://127.0.0.1:8131/openapi.json',
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
  'cron-agent',
  'hellscript-agent',
  'llm-usage-service',
  'user-service',
  'commands-agent',
  'actions-agent',
  'research-agent',
  'todos-agent',
  'image-service',
  'calendar-agent',
  'linear-agent',
  'chat-agent',
  'web-agent',
  'api-docs-hub',
];

const APP_SETTINGS_DEPENDENT_SERVICES = new Set([
  'user-service',
  'commands-agent',
  'actions-agent',
  'research-agent',
  'todos-agent',
  'image-service',
  'calendar-agent',
  'linear-agent',
  'chat-agent',
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

function nodeOptions() {
  const otelImport = '--import @intexuraos/infra-otel/register';
  const existing = process.env.NODE_OPTIONS ?? '';
  return existing.includes(otelImport)
    ? existing
    : [existing, otelImport].filter(Boolean).join(' ');
}

function pickEnv(keys) {
  return Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]])
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
  'INTEXURAOS_DASH0_AUTH_TOKEN',
  'INTEXURAOS_DASH0_OTLP_ENDPOINT',
  'INTEXURAOS_PUBLIC_ORIGIN',
  'INTEXURAOS_SENTRY_DSN',
];

const SERVICE_SECRET_KEYS = {
  'app-settings-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'notion-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'whatsapp-service': [
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_WHATSAPP_ACCESS_TOKEN',
    'INTEXURAOS_WHATSAPP_APP_SECRET',
    'INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID',
    'INTEXURAOS_WHATSAPP_VERIFY_TOKEN',
    'INTEXURAOS_WHATSAPP_WABA_ID',
  ],
  'mobile-notifications-service': [
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_OPENROUTER_APP_API_KEY',
  ],
  'fishing-assistant-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_OPENAI_APP_API_KEY'],
  'notes-agent': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'bookmarks-agent': ['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'code-agent': [
    'INTEXURAOS_GITHUB_WEBHOOK_SECRET',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_OPENAI_APP_API_KEY',
    'INTEXURAOS_OPENROUTER_APP_API_KEY',
    'INTEXURAOS_ORCHESTRATOR_SECRET',
    'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
    'INTEXURAOS_WEBHOOK_VERIFY_SECRET',
  ],
  'cron-agent': ['INTEXURAOS_GEMINI_APP_API_KEY', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'hellscript-agent': ['INTEXURAOS_GEMINI_APP_API_KEY', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'llm-usage-service': ['INTEXURAOS_INTERNAL_AUTH_TOKEN', 'INTEXURAOS_ORCHESTRATOR_SECRET'],
  'user-service': [
    'INTEXURAOS_AUTH0_CLIENT_ID',
    'INTEXURAOS_AUTH0_DOMAIN',
    'INTEXURAOS_ENCRYPTION_KEY',
    'INTEXURAOS_GITHUB_OAUTH_CLIENT_ID',
    'INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET',
    'INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID',
    'INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET',
    'INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
  ],
  'commands-agent': ['INTEXURAOS_GEMINI_APP_API_KEY', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'actions-agent': ['INTEXURAOS_GEMINI_APP_API_KEY', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'research-agent': ['INTEXURAOS_GEMINI_APP_API_KEY', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'todos-agent': ['INTEXURAOS_GEMINI_APP_API_KEY', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'image-service': ['INTEXURAOS_GEMINI_APP_API_KEY', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'calendar-agent': ['INTEXURAOS_GEMINI_APP_API_KEY', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'linear-agent': ['INTEXURAOS_GEMINI_APP_API_KEY', 'INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  'chat-agent': [
    'INTEXURAOS_GEMINI_APP_API_KEY',
    'INTEXURAOS_GUEST_SESSION_SECRET',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_OPENAI_APP_API_KEY',
  ],
  'web-agent': [
    'INTEXURAOS_CLOUDFLARE_ACCOUNT_ID',
    'INTEXURAOS_CLOUDFLARE_API_TOKEN',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  ],
};

const COMMON_SERVICE_ENV = {
  HOME: process.env.HOME ?? '/home/deploy',
  PATH: process.env.PATH,
  ...pickEnv(COMMON_ENV_KEYS),
  GOOGLE_APPLICATION_CREDENTIALS,
  INTEXURAOS_GCP_PROJECT_ID: PROJECT_ID,
  INTEXURAOS_ENVIRONMENT: 'prod',
  INTEXURAOS_RUNTIME: 'prod',
  INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? PUBLIC_ORIGIN,
  INTEXURAOS_WEB_URL: process.env.INTEXURAOS_WEB_URL ?? PUBLIC_ORIGIN,
  INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS:
    process.env.INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS ??
    'or:google/gemma-4-31b-it,gemini-2.5-flash',
  ...localServiceUrls(),
};

const SERVICE_ENV_MAPPINGS = {
  'user-service': {
    INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? PUBLIC_ORIGIN,
  },
  'whatsapp-service': {
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET:
      process.env.INTEXURAOS_WHATSAPP_MEDIA_BUCKET ??
      `intexuraos-whatsapp-media-${RETAINED_GCP_ENVIRONMENT}`,
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC:
      process.env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC ?? topic('whatsapp-media-cleanup'),
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION:
      process.env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION ??
      `${topic('whatsapp-media-cleanup')}-push`,
    INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC:
      process.env.INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC ?? topic('commands-ingest'),
    INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC ?? topic('whatsapp-webhook-process'),
    INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC:
      process.env.INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC ?? topic('audio-stored'),
    INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC:
      process.env.INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC ?? topic('approval-reply'),
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? topic('whatsapp-send'),
  },
  'mobile-notifications-service': {
    INTEXURAOS_DIGEST_LLM_MODEL:
      process.env.INTEXURAOS_DIGEST_LLM_MODEL ?? 'or:google/gemini-3-flash-preview',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? topic('whatsapp-send'),
    INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? PUBLIC_ORIGIN,
  },
  'research-agent': {
    INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC:
      process.env.INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC ?? topic('research-process'),
    INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC:
      process.env.INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC ?? topic('llm-analytics'),
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? topic('whatsapp-send'),
    INTEXURAOS_PUBSUB_LLM_CALL_TOPIC:
      process.env.INTEXURAOS_PUBSUB_LLM_CALL_TOPIC ?? topic('llm-call'),
    INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? PUBLIC_ORIGIN,
    INTEXURAOS_SHARED_CONTENT_BUCKET:
      process.env.INTEXURAOS_SHARED_CONTENT_BUCKET ??
      `intexuraos-shared-content-${RETAINED_GCP_ENVIRONMENT}`,
    INTEXURAOS_SHARE_BASE_URL:
      process.env.INTEXURAOS_SHARE_BASE_URL ?? `${PUBLIC_ORIGIN}/share/research`,
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL: process.env.INTEXURAOS_IMAGE_PUBLIC_BASE_URL ?? PUBLIC_ORIGIN,
  },
  'commands-agent': {
    INTEXURAOS_SERVICE_URL:
      process.env.INTEXURAOS_COMMANDS_SERVICE_URL ?? publicServiceUrl('commands-agent'),
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE:
      process.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE ?? topic('actions-queue'),
  },
  'actions-agent': {
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE:
      process.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE ?? topic('actions-queue'),
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? topic('whatsapp-send'),
    INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC:
      process.env.INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC ?? topic('calendar-preview'),
    INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? PUBLIC_ORIGIN,
  },
  'image-service': {
    INTEXURAOS_IMAGE_BUCKET:
      process.env.INTEXURAOS_IMAGE_BUCKET ?? `intexuraos-images-${RETAINED_GCP_ENVIRONMENT}`,
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL: process.env.INTEXURAOS_IMAGE_PUBLIC_BASE_URL ?? PUBLIC_ORIGIN,
  },
  'todos-agent': {
    INTEXURAOS_TODOS_PROCESSING_TOPIC:
      process.env.INTEXURAOS_TODOS_PROCESSING_TOPIC ?? topic('todos-processing'),
  },
  'bookmarks-agent': {
    INTEXURAOS_PUBSUB_BOOKMARK_ENRICH:
      process.env.INTEXURAOS_PUBSUB_BOOKMARK_ENRICH ?? topic('bookmark-enrich'),
    INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE:
      process.env.INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE ?? topic('bookmark-summarize'),
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? topic('whatsapp-send'),
  },
  'code-agent': {
    INTEXURAOS_SERVICE_URL: process.env.INTEXURAOS_SERVICE_URL ?? publicServiceUrl('code-agent'),
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? topic('whatsapp-send'),
    INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC:
      process.env.INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC ?? topic('pr-triage'),
    INTEXURAOS_EXECUTION_MEMORY_ENABLED: process.env.INTEXURAOS_EXECUTION_MEMORY_ENABLED ?? 'true',
    INTEXURAOS_QUEUE_MAX_SIZE: process.env.INTEXURAOS_QUEUE_MAX_SIZE ?? '50',
    INTEXURAOS_QUEUE_TTL_MINUTES: process.env.INTEXURAOS_QUEUE_TTL_MINUTES ?? '1440',
    INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS: process.env.INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS ?? '3',
    INTEXURAOS_RETRY_QUEUE_TTL_MINUTES: process.env.INTEXURAOS_RETRY_QUEUE_TTL_MINUTES ?? '10',
    INTEXURAOS_AUTO_RETRY_MAX_ATTEMPTS: process.env.INTEXURAOS_AUTO_RETRY_MAX_ATTEMPTS ?? '3',
    INTEXURAOS_ENABLE_METRICS: process.env.INTEXURAOS_ENABLE_METRICS ?? 'true',
  },
  'cron-agent': {
    INTEXURAOS_SERVICE_URL:
      process.env.INTEXURAOS_CRON_SERVICE_URL ?? publicServiceUrl('cron-agent'),
  },
  'llm-usage-service': {
    INTEXURAOS_SERVICE_URL:
      process.env.INTEXURAOS_LLM_USAGE_PUBLIC_URL ?? publicServiceUrl('llm-usage-service'),
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
      ...pickEnv(SERVICE_SECRET_KEYS[name] ?? []),
      ...(SERVICE_ENV_MAPPINGS[name] ?? {}),
      ...(waitForService === undefined ? {} : { WAIT_FOR_SERVICE: waitForService }),
      PORT: String(SERVICE_PORTS[name]),
      NODE_ENV: 'production',
      NODE_OPTIONS: nodeOptions(),
    },
    autorestart: true,
    kill_timeout: 5000,
    restart_delay: 5000,
    watch: false,
    max_memory_restart: process.env.INTEXURAOS_PM2_MAX_MEMORY_RESTART ?? '750M',
  };
}

module.exports = {
  apps: PROD_SERVICE_ORDER.map(createServiceConfig),
};
