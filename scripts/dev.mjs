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
 */

import { spawn, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  { name: 'research-agent', port: 8118, color: '\x1b[94m' },
];

const WEB_APP = { name: 'web', port: 3000, color: '\x1b[95m' };

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const processes = new Map();
let shuttingDown = false;

function log(prefix, message, color = '') {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`${DIM}[${timestamp}]${RESET} ${color}${prefix}${RESET} ${message}`);
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

async function startEmulators() {
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
}

async function waitForEmulators() {
  const maxAttempts = 60;
  const delayMs = 1000;

  const endpoints = [
    { name: 'Firestore', url: 'http://localhost:8101' },
    { name: 'Pub/Sub', url: 'http://localhost:8102' },
    { name: 'GCS', url: 'http://localhost:8103/storage/v1/b' },
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
  USER_SERVICE_OPENAPI_URL: 'http://localhost:8110/openapi.json',
  PROMPTVAULT_SERVICE_OPENAPI_URL: 'http://localhost:8111/openapi.json',
  NOTION_SERVICE_OPENAPI_URL: 'http://localhost:8112/openapi.json',
  WHATSAPP_SERVICE_OPENAPI_URL: 'http://localhost:8113/openapi.json',
  MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL: 'http://localhost:8114/openapi.json',
  LLM_ORCHESTRATOR_OPENAPI_URL: 'http://localhost:8116/openapi.json',
  COMMANDS_ROUTER_OPENAPI_URL: 'http://localhost:8117/openapi.json',
  RESEARCH_AGENT_OPENAPI_URL: 'http://localhost:8118/openapi.json',
};

const COMMON_SERVICE_ENV = {
  AUTH_JWKS_URL: process.env.INTEXURAOS_AUTH_JWKS_URL ?? '',
  AUTH_ISSUER: process.env.INTEXURAOS_AUTH_ISSUER ?? '',
  AUTH_AUDIENCE: process.env.INTEXURAOS_AUTH_AUDIENCE ?? '',
  AUTH0_DOMAIN: process.env.INTEXURAOS_AUTH0_DOMAIN ?? '',
  AUTH0_CLIENT_ID: process.env.INTEXURAOS_AUTH0_CLIENT_ID ?? '',
};

const SERVICE_ENV_MAPPINGS = {
  'commands-router': {
    USER_SERVICE_URL: process.env.INTEXURAOS_USER_SERVICE_URL ?? 'http://localhost:8110',
  },
  'llm-orchestrator': {
    USER_SERVICE_URL: process.env.INTEXURAOS_USER_SERVICE_URL ?? 'http://localhost:8110',
    INTERNAL_AUTH_TOKEN: process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN ?? '',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
  },
  'whatsapp-service': {
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION ?? 'whatsapp-send-message-sub',
  },
  'research-agent': {
    COMMANDS_ROUTER_URL: 'http://localhost:8117',
    LLM_ORCHESTRATOR_URL: process.env.INTEXURAOS_LLM_ORCHESTRATOR_URL ?? 'http://localhost:8116',
    USER_SERVICE_URL: process.env.INTEXURAOS_USER_SERVICE_URL ?? 'http://localhost:8110',
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

  const prefix = `[${service.name}]`.padEnd(30);

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

  const prefix = `[${WEB_APP.name}]`.padEnd(30);

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

async function startAllServices() {
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
  console.log(`  API Docs:         ${BOLD}http://localhost:8115${RESET}`);
  console.log(`  Firebase UI:      http://localhost:8100`);
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

  await stopEmulators();

  logOrchestrator('Goodbye!');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  const args = process.argv.slice(2);
  const emulatorsOnly = args.includes('--emulators-only');

  logOrchestrator('IntexuraOS Local Development Environment');
  logOrchestrator('');

  if (!(await checkDockerRunning())) {
    console.error('Error: Docker is not running. Please start Docker and try again.');
    process.exit(1);
  }

  validateEnvVars();

  try {
    await startEmulators();

    if (!emulatorsOnly) {
      await startAllServices();
    } else {
      logOrchestrator('Emulators started. Press Ctrl+C to stop.');
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
