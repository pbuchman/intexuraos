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
  INTEXURAOS_AUTH_JWKS_URL: process.env.INTEXURAOS_AUTH_JWKS_URL ?? '',
  INTEXURAOS_AUTH_ISSUER: process.env.INTEXURAOS_AUTH_ISSUER ?? '',
  INTEXURAOS_AUTH_AUDIENCE: process.env.INTEXURAOS_AUTH_AUDIENCE ?? '',
  INTEXURAOS_AUTH0_DOMAIN: process.env.INTEXURAOS_AUTH0_DOMAIN ?? '',
  INTEXURAOS_AUTH0_CLIENT_ID: process.env.INTEXURAOS_AUTH0_CLIENT_ID ?? '',
  INTEXURAOS_INTERNAL_AUTH_TOKEN: process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN ?? 'local-dev-token',
  INTEXURAOS_GCP_PROJECT_ID: process.env.INTEXURAOS_GCP_PROJECT_ID ?? 'intexuraos-dev',
  INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? 'http://localhost:3000',
  FIREBASE_AUTH_EMULATOR_HOST: 'localhost:8104',
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
    INTEXURAOS_WHATSAPP_ACCESS_TOKEN: process.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN ?? '',
    INTEXURAOS_WHATSAPP_APP_SECRET: process.env.INTEXURAOS_WHATSAPP_APP_SECRET ?? '',
    INTEXURAOS_WHATSAPP_WABA_ID: process.env.INTEXURAOS_WHATSAPP_WABA_ID ?? '',
    INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID: process.env.INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID ?? '',
    INTEXURAOS_WHATSAPP_VERIFY_TOKEN: process.env.INTEXURAOS_WHATSAPP_VERIFY_TOKEN ?? 'test-token',
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET:
      process.env.INTEXURAOS_WHATSAPP_MEDIA_BUCKET ?? 'whatsapp-media',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION:
      process.env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION ?? 'whatsapp-media-cleanup-sub',
    INTEXURAOS_SPEECHMATICS_API_KEY: process.env.INTEXURAOS_SPEECHMATICS_API_KEY ?? '',
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
    INTEXURAOS_DISPATCH_SIGNING_SECRET: 'dev-dispatch-signing-secret',
    INTEXURAOS_WEBHOOK_VERIFY_SECRET: 'dev-webhook-secret',
    INTEXURAOS_CF_ACCESS_CLIENT_ID: 'dev-cf-client-id',
    INTEXURAOS_CF_ACCESS_CLIENT_SECRET: 'dev-cf-client-secret',
    INTEXURAOS_ORCHESTRATOR_MAC_URL: 'http://localhost:8199',
    INTEXURAOS_ORCHESTRATOR_VM_URL: 'http://localhost:8198',
    INTEXURAOS_CODE_WORKERS: 'mac:http://localhost:8199:1,vm:http://localhost:8198:2',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
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
    INTEXURAOS_TOKEN_ENCRYPTION_KEY: process.env.INTEXURAOS_TOKEN_ENCRYPTION_KEY ?? '',
    INTEXURAOS_ENCRYPTION_KEY: process.env.INTEXURAOS_ENCRYPTION_KEY ?? '',
    INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID: process.env.INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID ?? '',
    INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET: process.env.INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  },
  'web-agent': {
    INTEXURAOS_CRAWL4AI_API_KEY: process.env.INTEXURAOS_CRAWL4AI_API_KEY ?? '',
  },
};

/**
 * Create a service configuration for PM2
 */
function createServiceConfig(name, port) {
  return {
    name,
    script: 'pnpm',
    args: ['exec', 'tsx', 'watch', 'src/index.ts'],
    cwd: `./apps/${name}`,
    interpreter: 'none', // pnpm is the script itself
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
    watch: false, // tsx watch handles file watching
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  };
}

module.exports = {
  apps: [
    // Services without dependencies (start first)
    createServiceConfig('app-settings-service', 8122),
    createServiceConfig('notion-service', 8112),
    createServiceConfig('whatsapp-service', 8113),
    createServiceConfig('mobile-notifications-service', 8114),
    createServiceConfig('commands-agent', 8117),
    createServiceConfig('actions-agent', 8118),
    createServiceConfig('notes-agent', 8121),
    createServiceConfig('todos-agent', 8123),
    createServiceConfig('bookmarks-agent', 8124),
    createServiceConfig('calendar-agent', 8125),
    createServiceConfig('linear-agent', 8126),
    createServiceConfig('code-agent', 8128),
    createServiceConfig('web-agent', 8127),

    // Services that depend on app-settings-service
    createServiceConfig('user-service', 8110),
    createServiceConfig('research-agent', 8116),
    createServiceConfig('data-insights-agent', 8119),
    createServiceConfig('image-service', 8120),

    // Web app (Vite dev server)
    {
      name: 'web',
      script: 'pnpm',
      args: ['run', 'dev'],
      cwd: './apps/web',
      interpreter: 'none',
      env: {
        ...process.env,
        ...COMMON_SERVICE_ENV,
        ...COMMON_SERVICE_URLS,
        NODE_ENV: 'development',
        VITE_PM2_MODE: 'true',
      },
      autorestart: true,
      max_restarts: 5,
      restart_delay: 2000,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
