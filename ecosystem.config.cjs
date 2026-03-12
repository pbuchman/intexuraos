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
  INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? 'http://localhost:3000',
  INTEXURAOS_MINIMAX_APP_API_KEY: process.env.INTEXURAOS_MINIMAX_APP_API_KEY,
  INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
  INTEXURAOS_ENVIRONMENT: process.env.INTEXURAOS_ENVIRONMENT ?? 'dev',
  INTEXURAOS_DASH0_OTLP_ENDPOINT: process.env.INTEXURAOS_DASH0_OTLP_ENDPOINT,
  INTEXURAOS_DASH0_AUTH_TOKEN: process.env.INTEXURAOS_DASH0_AUTH_TOKEN,
};

// All service URLs - mirrors Terraform local.common_service_env_vars
const COMMON_SERVICE_URLS = {
  INTEXURAOS_USER_SERVICE_URL: 'http://localhost:8110',
  INTEXURAOS_NOTION_SERVICE_URL: 'http://localhost:8112',
  INTEXURAOS_WHATSAPP_SERVICE_URL: 'http://localhost:8113',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL: 'http://localhost:8114',
  INTEXURAOS_RESEARCH_AGENT_URL: 'http://localhost:8116',
  INTEXURAOS_COMMANDS_AGENT_URL: 'http://localhost:8117',
  INTEXURAOS_ACTIONS_AGENT_URL: 'http://localhost:8118',
  INTEXURAOS_DATA_INSIGHTS_AGENT_URL: 'http://localhost:8119',
  INTEXURAOS_IMAGE_SERVICE_URL: 'http://localhost:8120',
  INTEXURAOS_NOTES_AGENT_URL: 'http://localhost:8121',
  INTEXURAOS_APP_SETTINGS_SERVICE_URL: 'http://localhost:8122',
  INTEXURAOS_TODOS_AGENT_URL: 'http://localhost:8123',
  INTEXURAOS_BOOKMARKS_AGENT_URL: 'http://localhost:8124',
  INTEXURAOS_CALENDAR_AGENT_URL: 'http://localhost:8125',
  INTEXURAOS_LINEAR_AGENT_URL: 'http://localhost:8126',
  INTEXURAOS_CHAT_AGENT_URL: 'http://localhost:8129',
  INTEXURAOS_CODE_AGENT_URL: 'https://dev.intexuraos.cloud/api/code',
  INTEXURAOS_WEB_AGENT_URL: 'http://localhost:8127',
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
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  },
  'whatsapp-service': {
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION ?? 'whatsapp-send-message-sub',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC:
      process.env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC ?? 'whatsapp-media-cleanup',
    INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC:
      process.env.INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC ?? 'commands-ingest',
    INTEXURAOS_WHATSAPP_ACCESS_TOKEN: process.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN,
    INTEXURAOS_WHATSAPP_APP_SECRET: process.env.INTEXURAOS_WHATSAPP_APP_SECRET,
    INTEXURAOS_WHATSAPP_WABA_ID: process.env.INTEXURAOS_WHATSAPP_WABA_ID,
    INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID: process.env.INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID,
    INTEXURAOS_WHATSAPP_VERIFY_TOKEN: process.env.INTEXURAOS_WHATSAPP_VERIFY_TOKEN,
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET:
      process.env.INTEXURAOS_WHATSAPP_MEDIA_BUCKET ?? 'whatsapp-media',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION:
      process.env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION ?? 'whatsapp-media-cleanup-sub',
    INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC ?? 'whatsapp-webhook-process',
    INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC:
      process.env.INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC ?? 'audio-stored-dev',
    INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC:
      process.env.INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC ?? 'approval-reply',
  },
  'actions-agent': {
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: process.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE ?? 'actions-queue',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC:
      process.env.INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC ?? 'calendar-preview',
    INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? 'http://localhost:3000',
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  },
  'code-agent': {
    INTEXURAOS_SERVICE_URL: 'https://dev.intexuraos.cloud/api/code',
    INTEXURAOS_WEBHOOK_VERIFY_SECRET: process.env.INTEXURAOS_WEBHOOK_VERIFY_SECRET,
    INTEXURAOS_ORCHESTRATOR_SECRET: process.env.INTEXURAOS_ORCHESTRATOR_SECRET,
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_TOKEN_ENCRYPTION_KEY: process.env.INTEXURAOS_TOKEN_ENCRYPTION_KEY,
    INTEXURAOS_GITHUB_WEBHOOK_SECRET: process.env.INTEXURAOS_GITHUB_WEBHOOK_SECRET,
    INTEXURAOS_QUEUE_MAX_SIZE: process.env.INTEXURAOS_QUEUE_MAX_SIZE ?? '10',
    INTEXURAOS_QUEUE_TTL_MINUTES: process.env.INTEXURAOS_QUEUE_TTL_MINUTES ?? '30',
    INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS: process.env.INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS ?? '3',
    INTEXURAOS_RETRY_QUEUE_TTL_MINUTES: process.env.INTEXURAOS_RETRY_QUEUE_TTL_MINUTES ?? '10',
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
    INTEXURAOS_AUTH_AUDIENCE: process.env.INTEXURAOS_AUTH_AUDIENCE,
    INTEXURAOS_AUTH_ISSUER: process.env.INTEXURAOS_AUTH_ISSUER,
    INTEXURAOS_AUTH_JWKS_URL: process.env.INTEXURAOS_AUTH_JWKS_URL,
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
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  },
  'commands-agent': {
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: process.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE ?? 'actions-queue',
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  },
  'todos-agent': {
    INTEXURAOS_TODOS_PROCESSING_TOPIC:
      process.env.INTEXURAOS_TODOS_PROCESSING_TOPIC ?? 'todos-processing',
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
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
    INTEXURAOS_CRAWL4AI_APP_API_KEY: process.env.INTEXURAOS_CRAWL4AI_APP_API_KEY,
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  },
  'linear-agent': {
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  },
  'calendar-agent': {
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  },
  'data-insights-agent': {
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  },
  'chat-agent': {
    INTEXURAOS_OPENAI_APP_API_KEY: process.env.INTEXURAOS_OPENAI_APP_API_KEY,
    INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
    INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
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
 */
function createServiceConfig(name, port, options = {}) {
  const { waitForService } = options;

  const baseConfig = {
    name,
    cwd: `./apps/${name}`,
    script: TSX_CLI,
    interpreter: 'node',
    env: {
      ...process.env,
      ...COMMON_SERVICE_ENV,
      ...COMMON_SERVICE_URLS,
      ...(SERVICE_ENV_MAPPINGS[name] ?? {}),
      PORT: String(port),
      NODE_ENV: 'development',
      NODE_OPTIONS: '--import @intexuraos/infra-otel/register',
    },
    autorestart: true,
    kill_timeout: 5000,
    restart_delay: 5000,
    watch: false,
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
    createServiceConfig('notes-agent', 8121),
    createServiceConfig('bookmarks-agent', 8124),
    createServiceConfig('code-agent', 8128),

    // Services that depend on app-settings-service (fetch pricing at startup)
    // Poll health endpoint until app-settings-service is ready (max 30s)
    createServiceConfig('user-service', 8110, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('commands-agent', 8117, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('actions-agent', 8118, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('research-agent', 8116, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('todos-agent', 8123, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('data-insights-agent', 8119, {
      waitForService: 'http://localhost:8122/health',
    }),
    createServiceConfig('image-service', 8120, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('calendar-agent', 8125, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('linear-agent', 8126, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('chat-agent', 8129, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('web-agent', 8127, { waitForService: 'http://localhost:8122/health' }),

    // Web app (Vite dev server — uses proxy for /api/* routes in dev environment)
    {
      name: 'web',
      cwd: './apps/web',
      script: path.resolve(__dirname, 'node_modules/vite/bin/vite.js'),
      args: ['--mode', 'development'],
      interpreter: 'node',
      env: {
        ...process.env,
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
