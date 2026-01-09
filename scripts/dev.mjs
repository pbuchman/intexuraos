#!/usr/bin/env node
/**
 * Local development orchestrator.
 *
 * Features:
 * - Starts emulators (Firestore, Pub/Sub, GCS) via docker compose
 * - Waits for emulators to be healthy
 * - Starts all 7 backend services with hot-reload (tsx watch)
 * - Starts web app with Vite dev server (hot module replacement)
 * - Aggregates logs with color-coding per service
 * - Graceful shutdown on SIGINT/SIGTERM
 *
 * Prerequisites:
 *   - direnv installed and allowed (direnv allow)
 *   - .envrc.local configured (cp .envrc.local.example .envrc.local)
 *
 * Usage:
 *   npm run dev           # Start all services + web app
 *   npm run dev:emulators # Start only emulators
 *   npm run dev:services  # Start only services + web app (assumes emulators are running)
 */

import { spawn, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

const SERVICES = [
  { name: 'user-service', port: 8110, color: '\x1b[36m' },
  { name: 'promptvault-service', port: 8111, color: '\x1b[33m' },
  { name: 'notion-service', port: 8112, color: '\x1b[35m' },
  { name: 'whatsapp-service', port: 8113, color: '\x1b[32m' },
  { name: 'mobile-notifications-service', port: 8114, color: '\x1b[34m' },
  { name: 'api-docs-hub', port: 8115, color: '\x1b[31m' },
  { name: 'llm-orchestrator', port: 8116, color: '\x1b[96m' },
  { name: 'commands-router', port: 8117, color: '\x1b[93m' },
  { name: 'actions-agent', port: 8118, color: '\x1b[94m' },
  { name: 'data-insights-service', port: 8119, color: '\x1b[92m' },
  { name: 'image-service', port: 8120, color: '\x1b[91m' },
  { name: 'notes-agent', port: 8121, color: '\x1b[37m' },
  { name: 'app-settings-service', port: 8122, color: '\x1b[95m' },
  { name: 'todos-agent', port: 8123, color: '\x1b[38;5;208m' },
  { name: 'bookmarks-agent', port: 8124, color: '\x1b[38;5;141m' },
  { name: 'calendar-agent', port: 8125, color: '\x1b[38;5;220m' },
];

const WEB_APP = { name: 'web', port: 3000, color: '\x1b[97m' };

const DOCKER_LOG_SERVICES = [
  { name: 'pubsub-ui', container: 'docker-pubsub-ui-1', color: '\x1b[90m' },
];

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const processes = new Map();
let shuttingDown = false;
let emulatorsStartedByUs = false;

function log(prefix, message, color = '') {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`\x1b[97m[${timestamp}]\x1b[0m ${color}${prefix}\x1b[0m ${message}`);
}

/**
 * Format pino JSON log line into readable format.
 * Input: {"level":30,"time":1767629271989,"name":"retryPendingActions","msg":"Processing pending action",...}
 * Output: [retryPendingActions] Processing pending action
 */
function formatPinoLog(line) {
  // Try to parse as JSON (pino format)
  if (!line.startsWith('{')) {
    return line;
  }

  try {
    const log = JSON.parse(line);
    const parts = [];

    // Add name/component if present
    if (log.name) {
      parts.push(`\x1b[36m[${log.name}]\x1b[0m`);
    }

    // Add message
    if (log.msg) {
      parts.push(log.msg);
    }

    // Add key context fields (exclude internal pino fields)
    const excludeKeys = new Set([
      'level',
      'time',
      'pid',
      'hostname',
      'name',
      'msg',
      'severity',
      'message',
    ]);
    const contextFields = Object.entries(log)
      .filter(([key]) => !excludeKeys.has(key))
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');

    if (contextFields) {
      parts.push(`\x1b[90m${contextFields}\x1b[0m`);
    }

    return parts.join(' ') || line;
  } catch {
    // Not valid JSON, return as-is
    return line;
  }
}

function logEmulator(message) {
  log('[emulators]', message, '\x1b[90m');
}

function logOrchestrator(message) {
  log('[dev]', message, `${BOLD}\x1b[97m`);
}

async function checkDockerRunning() {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function generateFirestoreConfig() {
  logOrchestrator('Generating Firestore config from migrations...');
  const generatorPath = join(ROOT_DIR, 'scripts', 'generate-firestore-config.mjs');
  const module = await import(pathToFileURL(generatorPath).href);
  if (module.generate) {
    const stats = await module.generate(true);
    logOrchestrator(
      `Generated ${stats.indexCount} indexes, ${stats.collectionCount} collection rules`
    );
  }
}

async function syncFirestore() {
  logOrchestrator('Syncing Firestore data from GCP...');

  const syncScript = join(ROOT_DIR, 'scripts', 'sync-firestore.sh');
  if (!existsSync(syncScript)) {
    throw new Error(`Firestore sync script not found: ${syncScript}`);
  }

  // Verify gcloud is authenticated
  try {
    execSync('gcloud auth print-access-token', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'gcloud is not authenticated. Run: gcloud auth login && gcloud auth application-default login'
    );
  }

  // Verify PROJECT_ID is set
  const projectId = process.env.PROJECT_ID || process.env.INTEXURAOS_GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error('PROJECT_ID or INTEXURAOS_GCP_PROJECT_ID must be set for Firestore sync');
  }

  execSync(`bash "${syncScript}"`, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      PROJECT_ID: projectId,
    },
  });

  logOrchestrator('Firestore sync completed');
}

async function startEmulators() {
  // Sync Firestore data from GCP first
  await syncFirestore();

  logOrchestrator('Starting emulators...');

  const composeFile = join(ROOT_DIR, 'docker', 'docker-compose.local.yaml');
  if (!existsSync(composeFile)) {
    throw new Error(`Docker compose file not found: ${composeFile}`);
  }

  try {
    execSync(`docker compose -f "${composeFile}" up -d`, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  } catch (error) {
    throw new Error(`Failed to start emulators: ${error.message}`);
  }

  logEmulator('Waiting for emulators to be healthy...');
  await waitForEmulators();
  logEmulator('All emulators are ready!');

  // Mark that we started the emulators (so we stop them on shutdown)
  emulatorsStartedByUs = true;
}

async function waitForEmulators() {
  const maxAttempts = 60;
  const delayMs = 1000;

  const endpoints = [
    { name: 'Firestore', url: 'http://localhost:8101' },
    { name: 'GCS', url: 'http://localhost:8103/storage/v1/b' },
    { name: 'Firebase Auth', url: 'http://localhost:8104' },
    { name: 'Pub/Sub UI', url: 'http://localhost:8105/health' },
  ];

  for (const endpoint of endpoints) {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(endpoint.url);
        if (response.ok || response.status === 200 || response.status === 404) {
          logEmulator(`${endpoint.name} is ready`);
          break;
        }
      } catch {
        // Connection refused, keep waiting
      }
      attempts++;
      if (attempts >= maxAttempts) {
        throw new Error(`${endpoint.name} emulator failed to start after ${maxAttempts} seconds`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const REQUIRED_ENV_VARS = [
  'GOOGLE_CLOUD_PROJECT',
  'INTEXURAOS_GCP_PROJECT_ID',
  'FIRESTORE_EMULATOR_HOST',
  'INTEXURAOS_ENCRYPTION_KEY',
];

function validateEnvVars() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error('');
    console.error('Missing required environment variables:');
    missing.forEach((name) => console.error(`  - ${name}`));
    console.error('');
    console.error('Make sure direnv is set up correctly:');
    console.error('  1. cp .envrc.local.example .envrc.local');
    console.error('  2. direnv allow');
    console.error('');
    process.exit(1);
  }
}

const API_DOCS_HUB_ENV = {
  INTEXURAOS_USER_SERVICE_OPENAPI_URL: 'http://localhost:8110/openapi.json',
  INTEXURAOS_PROMPTVAULT_SERVICE_OPENAPI_URL: 'http://localhost:8111/openapi.json',
  INTEXURAOS_NOTION_SERVICE_OPENAPI_URL: 'http://localhost:8112/openapi.json',
  INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL: 'http://localhost:8113/openapi.json',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL: 'http://localhost:8114/openapi.json',
  INTEXURAOS_LLM_ORCHESTRATOR_OPENAPI_URL: 'http://localhost:8116/openapi.json',
  INTEXURAOS_COMMANDS_ROUTER_OPENAPI_URL: 'http://localhost:8117/openapi.json',
  INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL: 'http://localhost:8118/openapi.json',
  INTEXURAOS_DATA_INSIGHTS_SERVICE_OPENAPI_URL: 'http://localhost:8119/openapi.json',
  INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL: 'http://localhost:8120/openapi.json',
  INTEXURAOS_NOTES_AGENT_OPENAPI_URL: 'http://localhost:8121/openapi.json',
  INTEXURAOS_APP_SETTINGS_SERVICE_URL: 'http://localhost:8122/openapi.json',
  INTEXURAOS_TODOS_AGENT_OPENAPI_URL: 'http://localhost:8123/openapi.json',
  INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL: 'http://localhost:8124/openapi.json',
  INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL: 'http://localhost:8125/openapi.json',
};

const COMMON_SERVICE_ENV = {
  INTEXURAOS_AUTH_JWKS_URL: process.env.INTEXURAOS_AUTH_JWKS_URL ?? '',
  INTEXURAOS_AUTH_ISSUER: process.env.INTEXURAOS_AUTH_ISSUER ?? '',
  INTEXURAOS_AUTH_AUDIENCE: process.env.INTEXURAOS_AUTH_AUDIENCE ?? '',
  INTEXURAOS_AUTH0_DOMAIN: process.env.INTEXURAOS_AUTH0_DOMAIN ?? '',
  INTEXURAOS_AUTH0_CLIENT_ID: process.env.INTEXURAOS_AUTH0_CLIENT_ID ?? '',
  INTEXURAOS_INTERNAL_AUTH_TOKEN: process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN ?? 'local-dev-token',
  FIREBASE_AUTH_EMULATOR_HOST: 'localhost:8104',
};

const SERVICE_ENV_MAPPINGS = {
  'commands-router': {
    INTEXURAOS_USER_SERVICE_URL: process.env.INTEXURAOS_USER_SERVICE_URL ?? 'http://localhost:8110',
    INTEXURAOS_ACTIONS_AGENT_SERVICE_URL:
      process.env.INTEXURAOS_ACTIONS_AGENT_SERVICE_URL ?? 'http://localhost:8118',
  },
  'llm-orchestrator': {
    INTEXURAOS_USER_SERVICE_URL: process.env.INTEXURAOS_USER_SERVICE_URL ?? 'http://localhost:8110',
    INTEXURAOS_IMAGE_SERVICE_URL:
      process.env.INTEXURAOS_IMAGE_SERVICE_URL ?? 'http://localhost:8120',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
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
  },
  'actions-agent': {
    INTEXURAOS_COMMANDS_ROUTER_URL: 'http://localhost:8117',
    INTEXURAOS_LLM_ORCHESTRATOR_URL:
      process.env.INTEXURAOS_LLM_ORCHESTRATOR_URL ?? 'http://localhost:8116',
    INTEXURAOS_USER_SERVICE_URL: process.env.INTEXURAOS_USER_SERVICE_URL ?? 'http://localhost:8110',
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: process.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE ?? 'actions-queue',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL ?? 'http://localhost:3000',
  },
  'data-insights-service': {
    INTEXURAOS_USER_SERVICE_URL: process.env.INTEXURAOS_USER_SERVICE_URL ?? 'http://localhost:8110',
  },
  'image-service': {
    INTEXURAOS_USER_SERVICE_URL: process.env.INTEXURAOS_USER_SERVICE_URL ?? 'http://localhost:8110',
  },
};

function startService(service) {
  const serviceDir = join(ROOT_DIR, 'apps', service.name);
  if (!existsSync(serviceDir)) {
    log(`[${service.name}]`, `Directory not found: ${serviceDir}`, '\x1b[31m');
    return null;
  }

  const env = {
    ...process.env,
    ...COMMON_SERVICE_ENV,
    ...(SERVICE_ENV_MAPPINGS[service.name] ?? {}),
    ...(service.name === 'api-docs-hub' ? API_DOCS_HUB_ENV : {}),
    PORT: String(service.port),
    NODE_ENV: 'development',
  };

  const child = spawn('npx', ['tsx', 'watch', 'src/index.ts'], {
    cwd: serviceDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `[${service.name}]`;

  const processLine = (stream) => {
    const rl = createInterface({ input: stream });
    rl.on('line', (line) => {
      const formatted = formatPinoLog(line);
      log(prefix, formatted, service.color);
    });
  };

  processLine(child.stdout);
  processLine(child.stderr);

  child.on('error', (error) => {
    log(prefix, `Error: ${error.message}`, '\x1b[31m');
  });

  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      log(prefix, `Exited with code ${code} (signal: ${signal})`, '\x1b[33m');
    }
    processes.delete(service.name);
  });

  processes.set(service.name, child);
  log(prefix, `Started on port ${String(service.port)}`, service.color);

  return child;
}

function startWebApp() {
  const webDir = join(ROOT_DIR, 'apps', 'web');
  if (!existsSync(webDir)) {
    log(`[${WEB_APP.name}]`, `Directory not found: ${webDir}`, '\x1b[31m');
    return null;
  }

  const env = {
    ...process.env,
    NODE_ENV: 'development',
  };

  const child = spawn('npm', ['run', 'dev'], {
    cwd: webDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  const prefix = `[${WEB_APP.name}]`;

  const processLine = (stream) => {
    const rl = createInterface({ input: stream });
    rl.on('line', (line) => {
      log(prefix, line, WEB_APP.color);
    });
  };

  processLine(child.stdout);
  processLine(child.stderr);

  child.on('error', (error) => {
    log(prefix, `Error: ${error.message}`, '\x1b[31m');
  });

  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      log(prefix, `Exited with code ${code} (signal: ${signal})`, '\x1b[33m');
    }
    processes.delete(WEB_APP.name);
  });

  processes.set(WEB_APP.name, child);
  log(prefix, `Started on port ${String(WEB_APP.port)}`, WEB_APP.color);

  return child;
}

function followDockerLogs(service) {
  const child = spawn('docker', ['logs', '-f', service.container], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `[${service.name}]`;

  const processLine = (stream) => {
    const rl = createInterface({ input: stream });
    rl.on('line', (line) => {
      log(prefix, line, service.color);
    });
  };

  processLine(child.stdout);
  processLine(child.stderr);

  child.on('error', (error) => {
    log(prefix, `Error: ${error.message}`, '\x1b[31m');
  });

  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      log(prefix, `Exited with code ${code} (signal: ${signal})`, '\x1b[33m');
    }
    processes.delete(`docker-${service.name}`);
  });

  processes.set(`docker-${service.name}`, child);
  log(prefix, 'Following docker logs...', service.color);

  return child;
}

async function startAllServices() {
  logOrchestrator('Following docker container logs...');
  for (const dockerService of DOCKER_LOG_SERVICES) {
    followDockerLogs(dockerService);
  }

  logOrchestrator('Starting services...');

  for (const service of SERVICES) {
    startService(service);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  logOrchestrator('Starting web app...');
  startWebApp();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  logOrchestrator(`All ${String(SERVICES.length)} services + web app started!`);
  logOrchestrator('');
  console.log(`  Web App:          ${BOLD}http://localhost:${String(WEB_APP.port)}${RESET}`);
  console.log(`  API Docs:         ${BOLD}http://localhost:8115/docs${RESET}`);
  console.log(`  Firebase UI:      http://localhost:8100`);
  console.log(`  Pub/Sub UI:       ${BOLD}http://localhost:8105${RESET}`);
  logOrchestrator('');
  logOrchestrator('Press Ctrl+C to stop all services');
}

async function stopEmulators() {
  logOrchestrator('Stopping emulators...');
  const composeFile = join(ROOT_DIR, 'docker', 'docker-compose.local.yaml');
  try {
    execSync(`docker compose -f "${composeFile}" down`, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  } catch {
    // Ignore errors during shutdown
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  logOrchestrator('Shutting down...');

  for (const [name, child] of processes) {
    log(`[${name}]`, 'Stopping...', '\x1b[33m');
    child.kill('SIGTERM');
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  for (const [name, child] of processes) {
    if (!child.killed) {
      log(`[${name}]`, 'Force killing...', '\x1b[31m');
      child.kill('SIGKILL');
    }
  }

  // Only stop emulators if we started them
  if (emulatorsStartedByUs) {
    await stopEmulators();
  }

  logOrchestrator('Goodbye!');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  const args = process.argv.slice(2);
  const emulatorsOnly = args.includes('--emulators-only');
  const servicesOnly = args.includes('--services-only');

  logOrchestrator('IntexuraOS Local Development Environment');
  logOrchestrator('');

  if (!(await checkDockerRunning())) {
    console.error('Error: Docker is not running. Please start Docker and try again.');
    process.exit(1);
  }

  validateEnvVars();

  try {
    await generateFirestoreConfig();

    if (servicesOnly) {
      // Assume emulators are already running
      logOrchestrator('Starting services only (emulators should be running)...');
      await startAllServices();
    } else if (emulatorsOnly) {
      // Start only emulators
      await startEmulators();
      logOrchestrator('Emulators started. Press Ctrl+C to stop.');
    } else {
      // Full startup: emulators + services
      await startEmulators();
      await startAllServices();
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    await shutdown();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
