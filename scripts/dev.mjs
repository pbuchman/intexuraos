#!/usr/bin/env node
/**
 * Local development orchestrator.
 *
 * Features:
 * - Starts emulators (Firestore, Pub/Sub, GCS) via docker compose
 * - Waits for emulators to be healthy
 * - Starts all 7 services with hot-reload (node --watch)
 * - Aggregates logs with color-coding per service
 * - Graceful shutdown on SIGINT/SIGTERM
 *
 * Usage:
 *   npm run dev           # Start all services
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
  { name: 'llm-orchestrator-service', port: 8116, color: '\x1b[96m' },
];

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
    { name: 'GCS', url: 'http://localhost:8103/storage/v1/b' },
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

function startService(service) {
  const serviceDir = join(ROOT_DIR, 'apps', service.name);
  if (!existsSync(serviceDir)) {
    log(`[${service.name}]`, `Directory not found: ${serviceDir}`, '\x1b[31m');
    return null;
  }

  const env = {
    ...process.env,
    PORT: String(service.port),
    NODE_ENV: 'development',
    FIRESTORE_EMULATOR_HOST: 'localhost:8101',
    PUBSUB_EMULATOR_HOST: 'localhost:8102',
    STORAGE_EMULATOR_HOST: 'http://localhost:8103',
  };

  const child = spawn('node', ['--watch', '--experimental-strip-types', 'src/index.ts'], {
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

async function startAllServices() {
  logOrchestrator('Starting services...');

  for (const service of SERVICES) {
    startService(service);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  logOrchestrator(`All ${String(SERVICES.length)} services started!`);
  logOrchestrator('');
  logOrchestrator('Service URLs:');
  for (const service of SERVICES) {
    console.log(`  ${service.color}${service.name}${RESET}: http://localhost:${String(service.port)}`);
  }
  logOrchestrator('');
  logOrchestrator('Emulator UIs:');
  console.log(`  Firebase UI: http://localhost:8100`);
  console.log(`  Firestore:   http://localhost:8101`);
  console.log(`  Pub/Sub:     http://localhost:8102`);
  console.log(`  GCS:         http://localhost:8103`);
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

  if (!await checkDockerRunning()) {
    console.error('Error: Docker is not running. Please start Docker and try again.');
    process.exit(1);
  }

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
