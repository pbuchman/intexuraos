#!/usr/bin/env node

import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORCHESTRATOR_ENV_ALLOWLIST = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'INTEXURAOS_CODE_AGENT_URL',
  'INTEXURAOS_CODE_WORKER_FORENSICS',
  'INTEXURAOS_CODE_WORKER_FORENSICS_PATH',
  'INTEXURAOS_CODE_WORKER_IMAGE',
  'INTEXURAOS_COMPLETION_MAX_ATTEMPTS',
  'INTEXURAOS_ENVIRONMENT',
  'INTEXURAOS_ERROR_HUB_HOST',
  'INTEXURAOS_GITHUB_APP_ID',
  'INTEXURAOS_GITHUB_APP_PRIVATE_KEY_PATH',
  'INTEXURAOS_GITHUB_INSTALLATION_ID',
  'INTEXURAOS_GIT_USER_EMAIL',
  'INTEXURAOS_GIT_USER_NAME',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_LINEAR_API_KEY',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_ORCHESTRATOR_SECRET',
  'INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS',
  'INTEXURAOS_PRESERVE_WORKER_CONTAINERS',
  'INTEXURAOS_PROJECT_ID',
  'INTEXURAOS_RELEASE',
  'INTEXURAOS_REPOSITORY_PATH',
  'INTEXURAOS_REPOSITORY_URL',
  'INTEXURAOS_RUNTIME',
  'INTEXURAOS_SENTRY_DSN',
  'INTEXURAOS_USAGE_WEBHOOK_URL',
  'INTEXURAOS_WORKER_CAPACITY',
  'KEEP_CONTAINERS_ALIVE',
  'LOG_LEVEL',
  'NODE_ENV',
  'PORT',
];

const REQUIRED_ORCHESTRATOR_ENV = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'INTEXURAOS_CODE_AGENT_URL',
  'INTEXURAOS_ERROR_HUB_HOST',
  'INTEXURAOS_GITHUB_APP_ID',
  'INTEXURAOS_GITHUB_APP_PRIVATE_KEY_PATH',
  'INTEXURAOS_GITHUB_INSTALLATION_ID',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_LINEAR_API_KEY',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_ORCHESTRATOR_SECRET',
  'INTEXURAOS_PROJECT_ID',
  'INTEXURAOS_REPOSITORY_URL',
  'INTEXURAOS_RUNTIME',
  'INTEXURAOS_USAGE_WEBHOOK_URL',
];

const TAILNET_DNS_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net$/u;

function fail(message) {
  throw new Error(message);
}

function readOptionValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(`${option} requires a value`);
  }
  return value;
}

function parseArgs(args) {
  let output;
  let userHome;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output') {
      output = readOptionValue(args, index, '--output');
      index += 1;
    } else if (argument === '--user-home') {
      userHome = readOptionValue(args, index, '--user-home');
      index += 1;
    } else {
      fail('Unknown orchestrator environment generator argument');
    }
  }

  const resolvedUserHome = userHome ?? homedir();
  if (!isAbsolute(resolvedUserHome)) {
    fail('--user-home must be an absolute path');
  }
  return {
    userHome: resolvedUserHome,
    output: resolve(output ?? join(resolvedUserHome, '.code-orchestrator', 'env')),
  };
}

function validateErrorHubHost(value) {
  let origin;
  if (!/\s/u.test(value)) {
    try {
      origin = new URL(`https://${value}`);
    } catch {
      origin = undefined;
    }
  }

  if (
    origin === undefined ||
    origin.hostname === '' ||
    !TAILNET_DNS_HOSTNAME_PATTERN.test(origin.hostname.toLowerCase()) ||
    origin.port !== '8443' ||
    origin.host.toLowerCase() !== value.toLowerCase() ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    fail('Invalid INTEXURAOS_ERROR_HUB_HOST; expected a private .ts.net host on port 8443');
  }
}

function readAllowedEnvironment(source, userHome) {
  const fixedHomeDevValues = {
    GOOGLE_APPLICATION_CREDENTIALS: join(
      userHome,
      '.config',
      'intexuraos',
      'home-orchestrator-sa-key.json'
    ),
    INTEXURAOS_ENVIRONMENT: 'dev',
    INTEXURAOS_RUNTIME: 'dev',
  };
  const defaults = {
    INTEXURAOS_CODE_AGENT_URL: 'http://localhost:8128',
    INTEXURAOS_GITHUB_APP_PRIVATE_KEY_PATH: join(userHome, '.code-orchestrator', 'github-app.pem'),
    INTEXURAOS_PROJECT_ID: source.INTEXURAOS_PROJECT_ID ?? source.PROJECT_ID,
    INTEXURAOS_REPOSITORY_PATH: join(userHome, '.code-orchestrator', 'repo'),
    INTEXURAOS_WORKER_CAPACITY: '3',
    LOG_LEVEL: 'info',
    PORT: '8199',
  };
  const result = {};

  for (const name of ORCHESTRATOR_ENV_ALLOWLIST) {
    const value = fixedHomeDevValues[name] ?? source[name] ?? defaults[name];
    if (value !== undefined && value !== '') {
      result[name] = value;
    }
  }

  const missing = REQUIRED_ORCHESTRATOR_ENV.filter((name) => result[name] === undefined);
  if (missing.length > 0) {
    fail(`Missing required orchestrator environment variables: ${missing.join(', ')}`);
  }
  validateErrorHubHost(result.INTEXURAOS_ERROR_HUB_HOST);
  return result;
}

function dotenvQuote(value) {
  if (value.includes('\0')) {
    fail('Orchestrator environment contains a forbidden control character');
  }
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')}"`;
}

function renderEnvironment(environment) {
  const lines = ORCHESTRATOR_ENV_ALLOWLIST.flatMap((name) => {
    const value = environment[name];
    return value === undefined ? [] : [`${name}=${dotenvQuote(value)}`];
  });
  return `# Generated by scripts/generate-orchestrator-env.mjs.\n# Strict allowlist; do not append the full application environment.\n${lines.join('\n')}\n`;
}

function writeAtomicMode600(output, contents) {
  const outputDirectory = dirname(output);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const tempPath = join(
    outputDirectory,
    `.${basename(output)}.${String(process.pid)}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    writeFileSync(tempPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, output);
    chmodSync(output, 0o600);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // The atomic rename removes the temporary path on success.
    }
  }
}

export function generateOrchestratorEnv({ source = process.env, output, userHome }) {
  const environment = readAllowedEnvironment(source, userHome);
  writeAtomicMode600(output, renderEnvironment(environment));
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    generateOrchestratorEnv({ ...options, source: process.env });
    process.stdout.write(`Wrote orchestrator environment to ${options.output} (mode 600)\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Orchestrator environment generation failed'}\n`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
