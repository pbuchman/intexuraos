/**
 * PM2 Ecosystem Configuration — PROD (Hetzner VM)
 *
 * Usage on the VM (as deploy user):
 *   cd /opt/intexuraos
 *   pm2 start ecosystem.config.prod.cjs
 *   pm2 save
 *
 * Key differences from ecosystem.config.cjs (dev/home-dev PM2):
 *   - Loads secrets from /home/deploy/.env.prod via dotenv (not env vars
 *     pre-exported by the shell). The deploy user owns the file at mode
 *     600; load-secrets.sh writes it from GCP Secret Manager.
 *   - NO PUBSUB_EMULATOR_HOST — talks to real GCP Pub/Sub.
 *   - HARD ENFORCEMENT: refuses to start if INTEXURAOS_ENVIRONMENT != 'prod'.
 *     This prevents the catastrophic "dev env vars ended up on the prod VM"
 *     class of bug.
 *   - NODE_ENV=production, watch: false (deploys trigger explicit reload).
 *   - Web SPA is NOT in this config — served as static files by nginx
 *     from /var/www/intexuraos/web/dist (see Phase 6 of INT-750).
 *
 * SECURITY NOTE: `...process.env` in createServiceConfig spreads ALL secrets
 * from .env.prod into every service process. This is pragmatic for a single-VM
 * deployment but means a compromised service process has access to all secrets
 * (e.g., chat-agent sees INTEXURAOS_TOKEN_ENCRYPTION_KEY). The per-service
 * SERVICE_ENV_MAPPINGS below only adds service-specific overrides on top of
 * the shared base — it does not restrict what each service can see.
 *
 * Topic naming: the Hetzner prod VM shares the same GCP project as the
 * Cloud Run dev environment (intexuraos-dev-pbuchman per Decision 3 of
 * the migration plan). That means the topic names still carry the `-dev`
 * suffix — there are no separate `-prod` topics. The per-service
 * SERVICE_ENV_MAPPINGS below pins the real topic names explicitly so
 * the services don't fall through to the dev-ecosystem.config.cjs
 * defaults (which are stale placeholder names like `whatsapp-send-message`).
 */

const path = require('path');
const dotenv = require('dotenv');

// ---- Load /home/deploy/.env.prod -----------------------------------------
// `quiet: true` suppresses dotenv v17's telemetry banner (would otherwise
// print "◇ injected env (51) from ..." on every PM2 spawn).
const ENV_FILE = '/home/deploy/.env.prod';
const result = dotenv.config({ path: ENV_FILE, quiet: true });
if (result.error) {
  throw new Error(`Failed to load ${ENV_FILE}: ${result.error.message}`);
}

// ---- HARD ENFORCEMENT ----------------------------------------------------
// If this check fails, every PM2 spawn dies immediately, loudly. Intended
// blast radius: catch "someone accidentally deployed dev env to prod"
// before any request hits a service.
if (process.env.INTEXURAOS_ENVIRONMENT !== 'prod') {
  throw new Error(
    `Refusing to start PM2: INTEXURAOS_ENVIRONMENT must be 'prod' on this host, ` +
      `got '${process.env.INTEXURAOS_ENVIRONMENT ?? '<unset>'}'. ` +
      `Check ${ENV_FILE} is loaded and contains INTEXURAOS_ENVIRONMENT=prod.`
  );
}

// ---- Shared env for every service ----------------------------------------
// Mirrors dev ecosystem.config.cjs:COMMON_SERVICE_ENV but with values
// sourced from the dotenv-loaded process.env (which now contains all
// INTEXURAOS_* secrets from /home/deploy/.env.prod). NODE_ENV and
// INTEXURAOS_ENVIRONMENT are hardcoded so dotenv can never override
// them to something unsafe.
const COMMON_SERVICE_ENV = {
  HOME: '/home/deploy',
  // NO PUBSUB_EMULATOR_HOST — prod talks to real GCP
  INTEXURAOS_AUTH_JWKS_URL: process.env.INTEXURAOS_AUTH_JWKS_URL,
  INTEXURAOS_AUTH_ISSUER: process.env.INTEXURAOS_AUTH_ISSUER,
  INTEXURAOS_AUTH_AUDIENCE: process.env.INTEXURAOS_AUTH_AUDIENCE,
  INTEXURAOS_AUTH0_DOMAIN: process.env.INTEXURAOS_AUTH0_DOMAIN,
  INTEXURAOS_AUTH0_CLIENT_ID: process.env.INTEXURAOS_AUTH0_CLIENT_ID,
  INTEXURAOS_AUTH0_SPA_CLIENT_ID: process.env.INTEXURAOS_AUTH0_SPA_CLIENT_ID,
  INTEXURAOS_INTERNAL_AUTH_TOKEN: process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN,
  INTEXURAOS_GCP_PROJECT_ID: process.env.INTEXURAOS_GCP_PROJECT_ID,
  INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL,
  INTEXURAOS_MINIMAX_APP_API_KEY: process.env.INTEXURAOS_MINIMAX_APP_API_KEY,
  INTEXURAOS_MIMO_APP_API_KEY: process.env.INTEXURAOS_MIMO_APP_API_KEY,
  INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
  INTEXURAOS_OPENROUTER_APP_API_KEY: process.env.INTEXURAOS_OPENROUTER_APP_API_KEY,
  INTEXURAOS_ENVIRONMENT: 'prod',
  INTEXURAOS_RUNTIME: 'prod',
  INTEXURAOS_DASH0_OTLP_ENDPOINT: process.env.INTEXURAOS_DASH0_OTLP_ENDPOINT,
  INTEXURAOS_DASH0_AUTH_TOKEN: process.env.INTEXURAOS_DASH0_AUTH_TOKEN,
  INTEXURAOS_SENTRY_DSN: process.env.INTEXURAOS_SENTRY_DSN,
  GOOGLE_APPLICATION_CREDENTIALS: '/home/deploy/sa-key.json',
};

// ---- Inter-service URLs --------------------------------------------------
// All services run on the same VM → use loopback. code-agent is the one
// exception: it also has external Cloud Run callers (orchestrator worker
// containers), so its URL must be publicly reachable. Pre-DNS-cutover,
// code-agent calls from within this VM still hit Cloud Run's code-agent
// via the existing intexuraos.cloud → GLB → Cloud Run path; post-cutover,
// they come back to this VM via nginx → localhost:8128.
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
  INTEXURAOS_WEB_AGENT_URL: 'http://localhost:8127',
  INTEXURAOS_CODE_AGENT_URL: 'https://intexuraos.cloud/api/code',
  INTEXURAOS_CHAT_AGENT_URL: 'http://localhost:8129',
  INTEXURAOS_CRON_AGENT_URL: 'http://localhost:8130',
  INTEXURAOS_HELLSCRIPT_AGENT_URL: 'http://localhost:8131',
  INTEXURAOS_LLM_USAGE_SERVICE_URL: 'http://localhost:8132',
};

// ---- Per-service env overrides ------------------------------------------
// Topic names use the `-dev` suffix because the GCP project is shared
// with the Cloud Run dev environment (per Decision 3 of INT-750). See
// terraform/environments/dev/main.tf line 605+ for the authoritative
// topic_name declarations.
const SERVICE_ENV_MAPPINGS = {
  'research-agent': {
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-dev',
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL: 'https://intexuraos.cloud',
    INTEXURAOS_SHARED_CONTENT_BUCKET: 'intexuraos-shared-content',
    INTEXURAOS_SHARE_BASE_URL: 'https://intexuraos.cloud',
    INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC: 'intexuraos-research-process-dev',
    INTEXURAOS_PUBSUB_LLM_CALL_TOPIC: 'intexuraos-llm-call-dev',
  },
  'whatsapp-service': {
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-dev',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION: 'intexuraos-whatsapp-send-prod-hetzner',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC: 'intexuraos-whatsapp-media-cleanup-dev',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION: 'intexuraos-whatsapp-media-cleanup-prod-hetzner',
    INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC: 'intexuraos-commands-ingest-dev',
    INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: 'intexuraos-whatsapp-webhook-process-dev',
    INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC: 'intexuraos-audio-stored-dev',
    INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC: 'intexuraos-approval-reply-dev',
    INTEXURAOS_WHATSAPP_ACCESS_TOKEN: process.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN,
    INTEXURAOS_WHATSAPP_APP_SECRET: process.env.INTEXURAOS_WHATSAPP_APP_SECRET,
    INTEXURAOS_WHATSAPP_WABA_ID: process.env.INTEXURAOS_WHATSAPP_WABA_ID,
    INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID: process.env.INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID,
    INTEXURAOS_WHATSAPP_VERIFY_TOKEN: process.env.INTEXURAOS_WHATSAPP_VERIFY_TOKEN,
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET: 'whatsapp-media',
  },
  'actions-agent': {
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: 'intexuraos-actions-queue-dev',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-dev',
    INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC: 'intexuraos-calendar-preview-dev',
    INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL,
  },
  'code-agent': {
    INTEXURAOS_SERVICE_URL: 'https://intexuraos.cloud/api/code',
    INTEXURAOS_WEBHOOK_VERIFY_SECRET: process.env.INTEXURAOS_WEBHOOK_VERIFY_SECRET,
    INTEXURAOS_ORCHESTRATOR_SECRET: process.env.INTEXURAOS_ORCHESTRATOR_SECRET,
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-dev',
    INTEXURAOS_TOKEN_ENCRYPTION_KEY: process.env.INTEXURAOS_TOKEN_ENCRYPTION_KEY,
    INTEXURAOS_GITHUB_WEBHOOK_SECRET: process.env.INTEXURAOS_GITHUB_WEBHOOK_SECRET,
    INTEXURAOS_EXECUTION_MEMORY_ENABLED: 'true',
    INTEXURAOS_OPENAI_APP_API_KEY: process.env.INTEXURAOS_OPENAI_APP_API_KEY,
    INTEXURAOS_QUEUE_MAX_SIZE: '50',
    INTEXURAOS_QUEUE_TTL_MINUTES: '1440',
    INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS: '3',
    INTEXURAOS_RETRY_QUEUE_TTL_MINUTES: '10',
  },
  'bookmarks-agent': {
    INTEXURAOS_PUBSUB_BOOKMARK_ENRICH: 'intexuraos-bookmark-enrich-dev',
    INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE: 'intexuraos-bookmark-summarize-dev',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-dev',
  },
  'image-service': {
    INTEXURAOS_IMAGE_BUCKET: 'intexuraos-images',
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL: 'https://intexuraos.cloud',
  },
  'commands-agent': {
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: 'intexuraos-actions-queue-dev',
  },
  'todos-agent': {
    INTEXURAOS_TODOS_PROCESSING_TOPIC: 'intexuraos-todos-processing-dev',
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
  'chat-agent': {
    INTEXURAOS_OPENAI_APP_API_KEY: process.env.INTEXURAOS_OPENAI_APP_API_KEY,
  },
  'llm-usage-service': {
    INTEXURAOS_ORCHESTRATOR_SECRET: process.env.INTEXURAOS_ORCHESTRATOR_SECRET,
  },
};

// ---- Entry-point wiring --------------------------------------------------
const TSX_CLI = path.resolve(__dirname, 'node_modules/tsx/dist/cli.mjs');
const WAIT_SCRIPT = path.resolve(__dirname, 'scripts/pm2-wait-start.mjs');

/**
 * Build a PM2 process config for a backend service.
 *
 * Uses tsx (via the tsx CLI entry, not the pnpm/sh wrapper) so PM2's
 * treekill can clean the entire child tree on restart without leaving
 * orphans. Matches dev ecosystem.config.cjs's lookup pattern but with
 * prod-only tweaks: NODE_ENV=production, watch: false,
 * max_memory_restart.
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
      NODE_ENV: 'production',
      NODE_OPTIONS: '--import @intexuraos/infra-otel/register',
    },
    autorestart: true,
    max_memory_restart: '512M',
    kill_timeout: 10000,
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
    // Services without startup dependencies
    createServiceConfig('app-settings-service', 8122),
    createServiceConfig('notion-service', 8112),
    createServiceConfig('whatsapp-service', 8113),
    createServiceConfig('mobile-notifications-service', 8114),
    createServiceConfig('notes-agent', 8121),
    createServiceConfig('bookmarks-agent', 8124),
    createServiceConfig('code-agent', 8128),
    createServiceConfig('cron-agent', 8130),
    createServiceConfig('hellscript-agent', 8131),
    createServiceConfig('llm-usage-service', 8132),

    // Services that poll app-settings-service /health before starting
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

    // NB: web SPA is NOT in this config — served by nginx as static files
    // from /var/www/intexuraos/web/dist (see Phase 6).
  ],
};
