#!/usr/bin/env node
/**
 * Development environment setup.
 *
 * Starts Docker emulators and validates environment.
 * Does NOT sync data.
 *
 * Usage:
 *   pnpm run dev:setup    # Start emulators (no sync)
 *
 * For full sync from GCP:
 *   pnpm run dev:sync     # Sync + start emulators + start services
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { createDockerComposeEnv } from './lib/docker-compose-env.mjs';
import { buildLocalEmulatorStartPlan } from './lib/local-emulator-lifecycle.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

function log(message) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`\x1b[97m[${timestamp}]\x1b[0m ${BOLD}[setup]${RESET} ${message}`);
}

function logSuccess(message) {
  log(`${GREEN}✓${RESET} ${message}`);
}

function logError(message) {
  log(`${RED}✗${RESET} ${message}`);
}

// Services and their ports (for conflict checking)
const SERVICES = [
  { name: 'app-settings-service', port: 8122 },
  { name: 'notion-service', port: 8112 },
  { name: 'whatsapp-service', port: 8113 },
  { name: 'mobile-notifications-service', port: 8114 },
  { name: 'fishing-assistant-service', port: 8119 },
  { name: 'notes-agent', port: 8121 },
  { name: 'bookmarks-agent', port: 8124 },
  { name: 'calendar-agent', port: 8125 },
  { name: 'linear-agent', port: 8126 },
  { name: 'code-agent', port: 8128 },
  { name: 'hellscript-agent', port: 8131 },
  { name: 'llm-usage-service', port: 8132 },
  { name: 'intex-agent', port: 8134 },
  { name: 'message-digest-service', port: 8135 },
  { name: 'web-agent', port: 8127 },
  { name: 'user-service', port: 8110 },
  { name: 'research-agent', port: 8116 },
  { name: 'image-service', port: 8120 },
];

const WEB_APP = { name: 'web', port: 3000 };

const REQUIRED_ENV_VARS = [
  'GOOGLE_CLOUD_PROJECT',
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_ENCRYPTION_KEY',
];

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

function validateEnvVars() {
  log('Validating environment variables...');
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
  logSuccess('Environment variables validated');
}

async function checkDockerRunning() {
  log('Checking Docker...');
  try {
    execSync('docker info', { stdio: 'pipe' });
    logSuccess('Docker is running');
    return true;
  } catch {
    logError('Docker is not running');
    return false;
  }
}

async function checkPortInUse(port) {
  try {
    const result = execSync(`lsof -i :${String(port)} -t 2>/dev/null || true`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    if (!result.trim()) {
      return { inUse: false };
    }

    const lines = result.trim().split('\n');
    const pid = lines[0];

    return { inUse: true, pid };
  } catch {
    return { inUse: false };
  }
}

async function checkPortsAvailable() {
  log('Checking for port conflicts...');

  const allPorts = [
    ...SERVICES.map((s) => ({ name: s.name, port: s.port, type: 'service' })),
    { name: WEB_APP.name, port: WEB_APP.port, type: 'web' },
    { name: 'API Docs Hub', port: 8133, type: 'service' },
    { name: 'Pub/Sub UI', port: 8105, type: 'emulator' },
    { name: 'Log Server', port: 8106, type: 'emulator' },
  ];

  const conflicts = [];

  for (const { name, port, type } of allPorts) {
    const { inUse, pid } = await checkPortInUse(port);
    if (inUse) {
      conflicts.push({ name, port, type, pid });
    }
  }

  if (conflicts.length > 0) {
    console.error('');
    console.error(`${BOLD}${RED}✖ Port conflicts detected!${RESET}`);
    console.error('');
    console.error('The following ports are already in use:');
    console.error('');

    for (const conflict of conflicts) {
      const { name, port, type, pid } = conflict;
      const typeLabel = type === 'emulator' ? 'Emulator' : type === 'web' ? 'Web App' : 'Service';
      console.error(
        `  ${BOLD}${YELLOW}Port ${String(port)}${RESET} (${typeLabel}: ${name})` +
          (pid ? ` - PID: ${pid}` : '')
      );
    }

    console.error('');
    console.error('To free up the ports, you can:');
    console.error(`  1. Kill the process: ${BOLD}kill -9 <PID>${RESET}`);
    console.error('  2. Stop PM2 services: pnpm exec pm2 stop all && pnpm exec pm2 delete all');
    console.error('  3. Stop Docker: docker compose -f docker/docker-compose.local.yaml down');
    console.error('');

    throw new Error('Port conflicts detected. Please resolve and try again.');
  }

  logSuccess('All ports are available');
}

// ---------------------------------------------------------------------------
// Firestore functions
// ---------------------------------------------------------------------------

async function generateFirestoreConfig() {
  log('Generating Firestore config from migrations...');
  const generatorPath = join(ROOT_DIR, 'scripts', 'generate-firestore-config.mjs');
  const module = await import(pathToFileURL(generatorPath).href);
  if (module.generate) {
    const stats = await module.generate(true);
    logSuccess(`Generated ${stats.indexCount} indexes, ${stats.collectionCount} collection rules`);
  }
}

// ---------------------------------------------------------------------------
// Emulator functions
// ---------------------------------------------------------------------------

async function startEmulators() {
  log('Starting emulators...');

  const composeFile = join(ROOT_DIR, 'docker', 'docker-compose.local.yaml');
  if (!existsSync(composeFile)) {
    throw new Error(`Docker compose file not found: ${composeFile}`);
  }

  const dockerEnv = createDockerComposeEnv();
  try {
    for (const command of buildLocalEmulatorStartPlan()) {
      execFileSync('docker', ['compose', '-f', composeFile, ...command], {
        cwd: ROOT_DIR,
        env: dockerEnv.env,
        stdio: 'inherit',
      });
    }
  } catch (error) {
    throw new Error(`Failed to start emulators: ${error.message}`);
  } finally {
    dockerEnv.cleanup();
  }

  log('Verifying all Docker services are running...');
  await verifyDockerServices(composeFile);

  log('Waiting for emulators to be healthy...');
  await waitForEmulators();
  logSuccess('All emulators are ready');
}

async function verifyDockerServices(composeFile) {
  const requiredServices = ['pubsub-ui'];

  const dockerEnv = createDockerComposeEnv();
  try {
    const output = execSync(`docker compose -f "${composeFile}" ps --format json`, {
      encoding: 'utf-8',
      env: dockerEnv.env,
      stdio: 'pipe',
    });

    const lines = output.trim().split('\n').filter(Boolean);
    const runningServices = new Set();

    for (const line of lines) {
      try {
        const container = JSON.parse(line);
        if (container.State === 'running') {
          runningServices.add(container.Service);
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    const missing = requiredServices.filter((s) => !runningServices.has(s));
    if (missing.length > 0) {
      throw new Error(
        `Required Docker services not running: ${missing.join(', ')}\n` +
          'Try: pnpm run emulators:start'
      );
    }

    log(`  All ${requiredServices.length} Docker services are running`);
  } catch (error) {
    if (error.message.includes('Required Docker services')) {
      throw error;
    }
    throw new Error(`Failed to verify Docker services: ${error.message}`);
  } finally {
    dockerEnv.cleanup();
  }
}

async function waitForEmulators() {
  const maxAttempts = 60;
  const delayMs = 1000;

  const endpoints = [{ name: 'Pub/Sub UI', url: 'http://localhost:8105/health' }];

  for (const endpoint of endpoints) {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(endpoint.url);
        if (response.ok || response.status === 200 || response.status === 404) {
          log(`  ${endpoint.name} is ready`);
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  console.log(`${BOLD}IntexuraOS Development Setup${RESET}`);
  console.log('');

  // Pre-flight checks
  if (!(await checkDockerRunning())) {
    console.error('Error: Docker is not running. Please start Docker and try again.');
    process.exit(1);
  }

  validateEnvVars();
  await checkPortsAvailable();

  // Setup
  await generateFirestoreConfig();
  await startEmulators();

  // Done
  console.log('');
  console.log(`${BOLD}${GREEN}✓ Setup complete!${RESET}`);
  console.log('');
  console.log('Emulator endpoints:');
  console.log('  Pub/Sub:          http://localhost:8102');
  console.log('  Pub/Sub UI:       http://localhost:8105');
  console.log('');
  console.log('Dev tools (start with PM2):');
  console.log('  Log Server:       http://localhost:8106 (DevBar Logs tab)');
  console.log('');
  console.log(`${BOLD}🌐 Application Endpoints:${RESET}`);
  console.log('  Web App:        http://localhost:3000');
  console.log('  Log Viewer:     http://localhost:8107');
  console.log('  API Docs Hub:   http://localhost:8133/docs');
  console.log('');
  console.log(`${BOLD}💡 Quick Check:${RESET}`);
  console.log('  curl http://localhost:3000       # Web app');
  console.log('  curl http://localhost:8133/docs  # API docs');
  console.log('  pnpm services:status             # All services');
  console.log('');
}

main().catch((error) => {
  logError(error.message);
  process.exit(1);
});
