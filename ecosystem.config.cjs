/**
 * PM2 Ecosystem Configuration
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs
 *   pm2 monit
 *   pm2 stop all
 *   pm2 delete all
 */
const { COMMON_SERVICE_URLS_GENERATED } = require('./ecosystem.generated.cjs');

const PM2_BASE_ENV = { ...process.env };
delete PM2_BASE_ENV.NODE_OPTIONS;

// Common auth secrets for all services (mirrors Terraform local.common_service_secrets)
const COMMON_SERVICE_ENV = {
  HOME: process.env.HOME ?? '/root',
  PUBSUB_EMULATOR_HOST: 'localhost:8102',
  INTEXURAOS_AUTH_JWKS_URL: process.env.INTEXURAOS_AUTH_JWKS_URL,
  INTEXURAOS_AUTH_ISSUER: process.env.INTEXURAOS_AUTH_ISSUER,
  INTEXURAOS_AUTH_AUDIENCE: process.env.INTEXURAOS_AUTH_AUDIENCE,
  INTEXURAOS_AUTH0_DOMAIN: process.env.INTEXURAOS_AUTH0_DOMAIN,
  INTEXURAOS_AUTH0_CLIENT_ID: process.env.INTEXURAOS_AUTH0_CLIENT_ID,
  INTEXURAOS_INTERNAL_AUTH_TOKEN: process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN,
  INTEXURAOS_GCP_PROJECT_ID: process.env.INTEXURAOS_GCP_PROJECT_ID,
  INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? 'https://dev.intexuraos.cloud',
  INTEXURAOS_MINIMAX_APP_API_KEY: process.env.INTEXURAOS_MINIMAX_APP_API_KEY,
  INTEXURAOS_MIMO_APP_API_KEY: process.env.INTEXURAOS_MIMO_APP_API_KEY,
  INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
  INTEXURAOS_KIMI_APP_API_KEY: process.env.INTEXURAOS_KIMI_APP_API_KEY,
  INTEXURAOS_OPENROUTER_APP_API_KEY: process.env.INTEXURAOS_OPENROUTER_APP_API_KEY,
  INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS:
    process.env.INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS ??
    'or:google/gemma-4-31b-it,gemini-2.5-flash',
  INTEXURAOS_ENVIRONMENT: process.env.INTEXURAOS_ENVIRONMENT ?? 'dev',
  INTEXURAOS_RUNTIME: 'dev',
};

// All service URLs - mirrors Terraform local.common_service_env_vars
const COMMON_SERVICE_URLS = {
  ...COMMON_SERVICE_URLS_GENERATED,
  INTEXURAOS_INTEX_AGENT_URL: 'http://localhost:8134',
  INTEXURAOS_API_DOCS_HUB_URL: 'http://localhost:8133',
};

// OpenAPI source URLs consumed by api-docs-hub. Each upstream service exposes
// `/openapi.json` on the same port as its main HTTP server (see COMMON_SERVICE_URLS).
const API_DOCS_HUB_OPENAPI_URLS = {
  INTEXURAOS_USER_SERVICE_OPENAPI_URL: 'http://localhost:8110/openapi.json',
  INTEXURAOS_NOTION_SERVICE_OPENAPI_URL: 'http://localhost:8112/openapi.json',
  INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL: 'http://localhost:8113/openapi.json',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL: 'http://localhost:8114/openapi.json',
  INTEXURAOS_FISHING_ASSISTANT_SERVICE_OPENAPI_URL: 'http://localhost:8119/openapi.json',
  INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL: 'http://localhost:8116/openapi.json',
  INTEXURAOS_COMMANDS_AGENT_OPENAPI_URL: 'http://localhost:8117/openapi.json',
  INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL: 'http://localhost:8118/openapi.json',
  INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL: 'http://localhost:8120/openapi.json',
  INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL: 'http://localhost:8122/openapi.json',
  INTEXURAOS_NOTES_AGENT_OPENAPI_URL: 'http://localhost:8121/openapi.json',
  INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL: 'http://localhost:8124/openapi.json',
  INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL: 'http://localhost:8125/openapi.json',
  INTEXURAOS_CODE_AGENT_OPENAPI_URL: 'https://dev.intexuraos.cloud/api/code/openapi.json',
  INTEXURAOS_LINEAR_AGENT_OPENAPI_URL: 'http://localhost:8126/openapi.json',
  INTEXURAOS_WEB_AGENT_OPENAPI_URL: 'http://localhost:8127/openapi.json',
  INTEXURAOS_HELLSCRIPT_AGENT_OPENAPI_URL: 'http://localhost:8131/openapi.json',
  INTEXURAOS_INTEX_AGENT_OPENAPI_URL: 'http://localhost:8134/openapi.json',
};

// Service-specific env vars (Pub/Sub topics, non-URL config)
const SERVICE_ENV_MAPPINGS = {
  'research-agent': {
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL:
      process.env.INTEXURAOS_IMAGE_PUBLIC_BASE_URL ?? 'http://localhost:3000',
    INTEXURAOS_SHARED_CONTENT_BUCKET:
      process.env.INTEXURAOS_SHARED_CONTENT_BUCKET ?? 'intexuraos-shared-content',
    INTEXURAOS_SHARE_BASE_URL: process.env.INTEXURAOS_SHARE_BASE_URL ?? 'http://localhost:3000',
    INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC:
      process.env.INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC ?? 'research-process',
    INTEXURAOS_PUBSUB_LLM_CALL_TOPIC: process.env.INTEXURAOS_PUBSUB_LLM_CALL_TOPIC ?? 'llm-call',
  },
  'whatsapp-service': {
    // home-dev publishes to the local Pub/Sub emulator on localhost:8102.
    // These fallbacks must match the emulator topic aliases configured in
    // tools/pubsub-ui/server.mjs, not the Terraform-managed Cloud Run topic
    // names (`intexuraos-*-dev`), or inbound webhooks fail before processing.
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION ?? 'whatsapp-send-message-push',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC:
      process.env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC ?? 'whatsapp-media-cleanup',
    INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC:
      process.env.INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC ?? 'commands-ingest',
    INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC:
      process.env.INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC ?? 'intex-message-ingest',
    INTEXURAOS_WHATSAPP_ACCESS_TOKEN: process.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN,
    INTEXURAOS_WHATSAPP_APP_SECRET: process.env.INTEXURAOS_WHATSAPP_APP_SECRET,
    INTEXURAOS_WHATSAPP_WABA_ID: process.env.INTEXURAOS_WHATSAPP_WABA_ID,
    INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID: process.env.INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID,
    INTEXURAOS_WHATSAPP_VERIFY_TOKEN: process.env.INTEXURAOS_WHATSAPP_VERIFY_TOKEN,
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET:
      process.env.INTEXURAOS_WHATSAPP_MEDIA_BUCKET ?? 'intexuraos-whatsapp-media-dev',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION:
      process.env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION ?? 'whatsapp-media-cleanup-push',
    INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC ?? 'whatsapp-webhook-process',
    INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC:
      process.env.INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC ?? 'whatsapp-transcription',
    INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC:
      process.env.INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC ?? 'approval-reply',
  },
  'actions-agent': {
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: process.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE ?? 'actions-queue',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC:
      process.env.INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC ?? 'calendar-preview',
  },
  'code-agent': {
    INTEXURAOS_SERVICE_URL: 'https://dev.intexuraos.cloud/api/code',
    INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL: 'https://dev.intexuraos.cloud/api/code',
    INTEXURAOS_WEBHOOK_VERIFY_SECRET: process.env.INTEXURAOS_WEBHOOK_VERIFY_SECRET,
    INTEXURAOS_ORCHESTRATOR_SECRET: process.env.INTEXURAOS_ORCHESTRATOR_SECRET,
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC:
      process.env.INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC ?? 'intexuraos-pr-triage-dev',
    INTEXURAOS_TOKEN_ENCRYPTION_KEY: process.env.INTEXURAOS_TOKEN_ENCRYPTION_KEY,
    INTEXURAOS_GITHUB_WEBHOOK_SECRET: process.env.INTEXURAOS_GITHUB_WEBHOOK_SECRET,
    INTEXURAOS_EXECUTION_MEMORY_ENABLED: process.env.INTEXURAOS_EXECUTION_MEMORY_ENABLED ?? 'false',
    INTEXURAOS_OPENROUTER_APP_API_KEY: process.env.INTEXURAOS_OPENROUTER_APP_API_KEY,
    INTEXURAOS_OPENAI_APP_API_KEY: process.env.INTEXURAOS_OPENAI_APP_API_KEY,
    INTEXURAOS_QUEUE_MAX_SIZE: process.env.INTEXURAOS_QUEUE_MAX_SIZE ?? '50',
    INTEXURAOS_QUEUE_TTL_MINUTES: process.env.INTEXURAOS_QUEUE_TTL_MINUTES ?? '1440',
    INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS: process.env.INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS ?? '3',
    INTEXURAOS_RETRY_QUEUE_TTL_MINUTES: process.env.INTEXURAOS_RETRY_QUEUE_TTL_MINUTES ?? '10',
    INTEXURAOS_AUTO_RETRY_MAX_ATTEMPTS: process.env.INTEXURAOS_AUTO_RETRY_MAX_ATTEMPTS ?? '3',
    // INTEXURAOS_LLM_USAGE_SERVICE_URL: already in COMMON_SERVICE_URLS (http://localhost:8132)
    // INTEXURAOS_ENABLE_METRICS: not set — Cloud Monitoring disabled on home-dev (no IAM role)
  },
  'linear-agent': {
    INTEXURAOS_SERVICE_URL: 'https://dev.intexuraos.cloud/api/linear',
  },
  'bookmarks-agent': {
    INTEXURAOS_PUBSUB_BOOKMARK_ENRICH:
      process.env.INTEXURAOS_PUBSUB_BOOKMARK_ENRICH ?? 'bookmark-enrich',
    INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE:
      process.env.INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE ?? 'bookmark-summarize',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
  },
  'image-service': {
    INTEXURAOS_IMAGE_BUCKET: process.env.INTEXURAOS_IMAGE_BUCKET ?? 'intexuraos-images',
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL:
      process.env.INTEXURAOS_IMAGE_PUBLIC_BASE_URL ?? 'http://localhost:3000',
  },
  'commands-agent': {
    INTEXURAOS_SERVICE_URL: 'http://localhost:8117',
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: process.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE ?? 'actions-queue',
  },
  'user-service': {
    INTEXURAOS_TOKEN_ENCRYPTION_KEY: process.env.INTEXURAOS_TOKEN_ENCRYPTION_KEY,
    INTEXURAOS_ENCRYPTION_KEY: process.env.INTEXURAOS_ENCRYPTION_KEY,
    INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID: process.env.INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID,
    INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET: process.env.INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET,
    INTEXURAOS_GITHUB_OAUTH_CLIENT_ID: process.env.INTEXURAOS_GITHUB_OAUTH_CLIENT_ID,
    INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET: process.env.INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET,
  },
  'web-agent': {
    INTEXURAOS_CLOUDFLARE_ACCOUNT_ID: process.env.INTEXURAOS_CLOUDFLARE_ACCOUNT_ID,
    INTEXURAOS_CLOUDFLARE_API_TOKEN: process.env.INTEXURAOS_CLOUDFLARE_API_TOKEN,
  },
  'fishing-assistant-service': {
    INTEXURAOS_OPENAI_APP_API_KEY: process.env.INTEXURAOS_OPENAI_APP_API_KEY,
  },
  'llm-usage-service': {
    INTEXURAOS_ORCHESTRATOR_SECRET: process.env.INTEXURAOS_ORCHESTRATOR_SECRET,
  },
  'mobile-notifications-service': {
    INTEXURAOS_DIGEST_LLM_MODEL:
      process.env.INTEXURAOS_DIGEST_LLM_MODEL ?? 'or:google/gemini-3-flash-preview',
    INTEXURAOS_OPENROUTER_APP_API_KEY: process.env.INTEXURAOS_OPENROUTER_APP_API_KEY,
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
  },
  'intex-agent': {
    INTEXURAOS_OPENROUTER_APP_API_KEY: process.env.INTEXURAOS_OPENROUTER_APP_API_KEY,
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS:
      process.env.INTEXURAOS_INTEX_AGENT_SESSION_TIMEOUT_MS ?? '1800000',
  },
  'api-docs-hub': {
    ...API_DOCS_HUB_OPENAPI_URLS,
  },
};

const path = require('path');

// tsx CLI path — PM2 runs `node tsx/cli.mjs src/index.ts` directly.
// Old chain: pnpm → sh → tsx → node (4 levels, orphan-prone).
// New chain: tsx CLI → node (2 levels, treekill cleans both).
const TSX_CLI = path.resolve(__dirname, 'node_modules/tsx/dist/cli.mjs');
const WAIT_SCRIPT = path.resolve(__dirname, 'scripts/pm2-wait-start.mjs');

/**
 * Create a service configuration for PM2
 *
 * Runs tsx CLI directly via `interpreter: 'node'`. This collapses the
 * old pnpm → sh → tsx → node chain into tsx → node (2 processes).
 * PM2's treekill cleans both on restart — no orphan children.
 * Uses PM2's native file watching for change detection.
 * Watches src/ so deploys to the dev VM auto-restart the service.
 */
function createServiceConfig(name, port, options = {}) {
  const { waitForService } = options;

  const baseConfig = {
    name,
    cwd: `./apps/${name}`,
    script: TSX_CLI,
    interpreter: 'node',
    env: {
      ...PM2_BASE_ENV,
      ...COMMON_SERVICE_ENV,
      ...COMMON_SERVICE_URLS,
      ...(SERVICE_ENV_MAPPINGS[name] ?? {}),
      PORT: String(port),
      NODE_ENV: 'development',
    },
    autorestart: true,
    kill_timeout: 5000,
    restart_delay: 5000,
    watch: ['src'],
    ignore_watch: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
    watch_delay: 1000,
  };

  if (waitForService) {
    return {
      ...baseConfig,
      args: [WAIT_SCRIPT, 'src/index.ts'],
      env: {
        ...baseConfig.env,
        WAIT_FOR_SERVICE: waitForService,
      },
    };
  }

  return {
    ...baseConfig,
    args: ['src/index.ts'],
  };
}

module.exports = {
  apps: [
    // Services without dependencies (start first)
    createServiceConfig('app-settings-service', 8122),
    createServiceConfig('notion-service', 8112),
    createServiceConfig('whatsapp-service', 8113),
    createServiceConfig('mobile-notifications-service', 8114),
    createServiceConfig('fishing-assistant-service', 8119),
    createServiceConfig('notes-agent', 8121),
    createServiceConfig('bookmarks-agent', 8124),
    createServiceConfig('code-agent', 8128),
    createServiceConfig('hellscript-agent', 8131),
    createServiceConfig('llm-usage-service', 8132),
    createServiceConfig('intex-agent', 8134),

    // Services that depend on app-settings-service (fetch pricing at startup)
    // Poll health endpoint until app-settings-service is ready (max 30s)
    createServiceConfig('user-service', 8110, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('commands-agent', 8117, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('actions-agent', 8118, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('research-agent', 8116, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('image-service', 8120, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('calendar-agent', 8125, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('linear-agent', 8126, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('web-agent', 8127, { waitForService: 'http://localhost:8122/health' }),

    // Aggregates `/openapi.json` from every other service — register last so
    // upstream services have already been started by the time it boots.
    createServiceConfig('api-docs-hub', 8133),

    // Web app (Vite dev server — uses proxy for /api/* routes in dev environment)
    {
      name: 'web',
      cwd: './apps/web',
      script: path.resolve(__dirname, 'node_modules/vite/bin/vite.js'),
      args: ['--mode', 'development'],
      interpreter: 'node',
      env: {
        ...PM2_BASE_ENV,
        ...COMMON_SERVICE_ENV,
        ...COMMON_SERVICE_URLS,
        NODE_ENV: 'development',
        VITE_PM2_MODE: 'true',
        INTEXURAOS_USE_FIREBASE_EMULATORS: 'false',
      },
      autorestart: true,
      max_restarts: 5,
      kill_timeout: 5000,
      restart_delay: 2000,
      watch: false,
    },
  ],
};
