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
  INTEXURAOS_AUTH_JWKS_URL: process.env.INTEXURAOS_AUTH_JWKS_URL,
  INTEXURAOS_AUTH_ISSUER: process.env.INTEXURAOS_AUTH_ISSUER,
  INTEXURAOS_AUTH_AUDIENCE: process.env.INTEXURAOS_AUTH_AUDIENCE,
  INTEXURAOS_AUTH0_DOMAIN: process.env.INTEXURAOS_AUTH0_DOMAIN,
  INTEXURAOS_AUTH0_CLIENT_ID: process.env.INTEXURAOS_AUTH0_CLIENT_ID,
  INTEXURAOS_INTERNAL_AUTH_TOKEN: process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN,
  INTEXURAOS_GCP_PROJECT_ID: process.env.INTEXURAOS_GCP_PROJECT_ID,
  INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? 'http://localhost:3000',
  INTEXURAOS_GUEST_ZAI_API_KEY: process.env.INTEXURAOS_GUEST_ZAI_API_KEY,
  INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
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
  INTEXURAOS_CODE_AGENT_URL: 'http://localhost:8128',
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
    INTEXURAOS_SPEECHMATICS_API_KEY: process.env.INTEXURAOS_SPEECHMATICS_API_KEY,
    INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC ?? 'whatsapp-webhook-process',
    INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC:
      process.env.INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC ?? 'whatsapp-transcription',
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
  },
  'code-agent': {
    INTEXURAOS_SERVICE_URL: 'http://localhost:8128',
    INTEXURAOS_WEBHOOK_VERIFY_SECRET: process.env.INTEXURAOS_WEBHOOK_VERIFY_SECRET,
    INTEXURAOS_ORCHESTRATOR_SECRET: process.env.INTEXURAOS_ORCHESTRATOR_SECRET,
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_TOKEN_ENCRYPTION_KEY: process.env.INTEXURAOS_TOKEN_ENCRYPTION_KEY,
    INTEXURAOS_GITHUB_WEBHOOK_SECRET: process.env.INTEXURAOS_GITHUB_WEBHOOK_SECRET,
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
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: process.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE ?? 'actions-queue',
  },
  'todos-agent': {
    INTEXURAOS_TODOS_PROCESSING_TOPIC:
      process.env.INTEXURAOS_TODOS_PROCESSING_TOPIC ?? 'todos-processing',
  },
  'user-service': {
    INTEXURAOS_TOKEN_ENCRYPTION_KEY: process.env.INTEXURAOS_TOKEN_ENCRYPTION_KEY,
    INTEXURAOS_ENCRYPTION_KEY: process.env.INTEXURAOS_ENCRYPTION_KEY,
    INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID: process.env.INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID,
    INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET: process.env.INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET,
  },
  'web-agent': {
    INTEXURAOS_CRAWL4AI_API_KEY: process.env.INTEXURAOS_CRAWL4AI_API_KEY,
  },
  'chat-agent': {
    // OpenAI API key for embeddings (from .envrc)
    INTEXURAOS_OPENAI_API_KEY: process.env.INTEXURAOS_OPENAI_API_KEY,
  },
};

/**
 * Create a service configuration for PM2
 *
 * Uses PM2's native file watching instead of tsx watch.
 * This ensures PM2 can detect crashes and trigger autorestart properly.
 * With tsx watch, the wrapper process stays alive even when the app crashes,
 * causing PM2 to report "online" for dead services.
 */
function createServiceConfig(name, port, options = {}) {
  const { waitForService } = options;

  const baseConfig = {
    name,
    cwd: `./apps/${name}`,
    env: {
      ...process.env,
      ...COMMON_SERVICE_ENV,
      ...COMMON_SERVICE_URLS,
      ...(SERVICE_ENV_MAPPINGS[name] ?? {}),
      PORT: String(port),
      NODE_ENV: 'development',
    },
    autorestart: true,
    restart_delay: 5000,
    watch: ['src', '../../packages'],
    watch_delay: 1000,
    ignore_watch: ['node_modules', '__tests__', '**/*.test.ts', '**/*.spec.ts', 'dist'],
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  };

  if (waitForService) {
    return {
      ...baseConfig,
      script: 'bash',
      args: [
        '-c',
        `n=0; until curl -sf ${waitForService} > /dev/null 2>&1 || [ $n -ge 30 ]; do sleep 1; n=$((n+1)); done && pnpm --filter ${name} start:local`,
      ],
      interpreter: 'none',
    };
  }

  return {
    ...baseConfig,
    script: 'pnpm',
    args: ['--filter', name, 'start:local'],
    interpreter: 'none',
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
      script: 'pnpm',
      args: ['--filter', 'web', 'dev'],
      interpreter: 'none',
      env: {
        ...process.env,
        ...COMMON_SERVICE_ENV,
        ...COMMON_SERVICE_URLS,
        NODE_ENV: 'development',
        VITE_PM2_MODE: 'true',
        INTEXURAOS_USE_FIREBASE_EMULATORS: process.env.INTEXURAOS_USE_FIREBASE_EMULATORS ?? 'false',
      },
      autorestart: true,
      max_restarts: 5,
      restart_delay: 2000,
      watch: ['src', '../../packages'],
      watch_delay: 1000,
      ignore_watch: ['node_modules', '__tests__', '**/*.test.ts', '**/*.spec.ts', 'dist'],
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // Log server for DevBar (streams PM2 logs via SSE, similar to pubsub-ui)
    {
      name: 'log-server',
      script: 'node',
      args: ['server.mjs'],
      cwd: './tools/log-server',
      interpreter: 'none',
      env: {
        PORT: '8106',
        NODE_ENV: 'development',
      },
      autorestart: true,
      max_restarts: 3,
      restart_delay: 1000,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // Log viewer UI for DevBar (connects to log-server via SSE)
    {
      name: 'log-viewer',
      script: 'pnpm',
      args: ['run', 'dev'],
      cwd: './tools/log-viewer',
      interpreter: 'none',
      env: {
        PORT: '8107',
        NODE_ENV: 'development',
      },
      autorestart: true,
      max_restarts: 3,
      restart_delay: 2000,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
