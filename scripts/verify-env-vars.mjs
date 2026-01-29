#!/usr/bin/env node
/**
 * Environment Variable Verification Script.
 *
 * Ensures all services properly declare their required environment variables.
 *
 * Checks:
 * 1. All process.env usage is declared in REQUIRED_ENV (or is globally optional)
 * 2. All REQUIRED_ENV vars are registered in scripts/dev.mjs
 *
 * Usage:
 *   node scripts/verify-env-vars.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appsDir = join(repoRoot, 'apps');
const devMjsPath = join(repoRoot, 'scripts', 'dev.mjs');

const errors = [];
const warnings = [];

// Standard env vars that don't need to be declared (built-in, test-only, or set by framework)
const STANDARD_ENV_VARS = new Set([
  'NODE_ENV',
  'PORT',
  'HOST',
  'PATH',
  'HOME',
  'TMPDIR',
  'VITEST', // Test framework
  'TZ', // Timezone
]);

// Env vars that are commonly optional (have safe defaults)
const COMMON_OPTIONAL_ENV = new Set([
  'INTEXURAOS_SENTRY_DSN',
  'INTEXURAOS_ENVIRONMENT',
  'LOG_LEVEL',
  // E2E testing env vars (used by code-agent in E2E mode)
  'E2E_MODE',
  'E2E_TEST_USER_ID',
  // Optional service config vars (have E2E defaults or are production-only)
  'INTEXURAOS_SERVICE_URL',
  'INTEXURAOS_CODE_WORKERS',
  'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_LINEAR_AGENT_URL',
  'INTEXURAOS_ACTIONS_AGENT_URL',
  'INTEXURAOS_CF_ACCESS_CLIENT_ID',
  'INTEXURAOS_CF_ACCESS_CLIENT_SECRET',
  // Auth0 JWT vars (optional in E2E mode)
  'INTEXURAOS_AUTH0_AUDIENCE',
  'INTEXURAOS_AUTH0_ISSUER',
  'INTEXURAOS_AUTH0_JWKS_URI',
  // Old names (used by some configs, aliased to Auth0 versions)
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_JWKS_URL',
]);

/**
 * Find all TypeScript files in a directory recursively.
 */
function findTsFiles(dir, files = []) {
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (
      stat.isDirectory() &&
      entry !== 'node_modules' &&
      entry !== 'dist' &&
      entry !== '__tests__'
    ) {
      findTsFiles(fullPath, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract REQUIRED_ENV array from a service's index.ts file.
 */
function extractRequiredEnv(indexContent) {
  const requiredEnvPattern = /const\s+REQUIRED_ENV\s*=\s*\[([\s\S]*?)\];/;
  const match = indexContent.match(requiredEnvPattern);

  if (!match) {
    return [];
  }

  // Extract string literals from the array
  const vars = [];
  const stringPattern = /'([^']+)'/g;
  let stringMatch;

  while ((stringMatch = stringPattern.exec(match[1])) !== null) {
    vars.push(stringMatch[1]);
  }

  return vars;
}

/**
 * Find all process.env accesses in a file with line numbers.
 */
function findEnvAccesses(content) {
  const accesses = [];
  const lines = content.split('\n');

  // Patterns for process.env access:
  // 1. process.env['VAR_NAME'] - bracket notation with single quotes
  // 2. process.env["VAR_NAME"] - bracket notation with double quotes
  // 3. process.env[backtick]VAR_NAME[backtick] - bracket notation with template literals
  // 4. process.env.VAR_NAME - dot notation (only uppercase identifiers)
  const patterns = [
    /process\.env\['([^']+)'\]/g,
    /process\.env\["([^"]+)"\]/g,
    /process\.env\[`([^`]+)`\]/g,
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Skip comment lines
    const trimmedLine = line.trim();
    if (
      trimmedLine.startsWith('//') ||
      trimmedLine.startsWith('/*') ||
      trimmedLine.startsWith('*')
    ) {
      continue;
    }

    for (const pattern of patterns) {
      let match;
      // Reset regex for each line
      pattern.lastIndex = 0;
      while ((match = pattern.exec(line)) !== null) {
        const varName = match[1];
        accesses.push({ varName, line: lineNumber, content: line.trim() });
      }
    }
  }

  return accesses;
}

/**
 * Parse dev.mjs to extract SERVICE_ENV_MAPPINGS.
 */
function parseDevMjsMappings() {
  if (!existsSync(devMjsPath)) {
    errors.push('scripts/dev.mjs not found');
    return {};
  }

  const content = readFileSync(devMjsPath, 'utf8');

  // Extract SERVICE_ENV_MAPPINGS object
  const mappingsPattern = /const\s+SERVICE_ENV_MAPPINGS\s*=\s*\{([\s\S]*?)\n\};/;
  const match = content.match(mappingsPattern);

  if (!match) {
    return {};
  }

  const mappings = {};
  const servicePattern = /'([^']+)':\s*\{([\s\S]*?)\}/g;
  let serviceMatch;

  while ((serviceMatch = servicePattern.exec(match[1])) !== null) {
    const serviceName = serviceMatch[1];
    const serviceContent = serviceMatch[2];

    // Extract env var names for this service
    const envVars = [];
    const envVarPattern = /INTEXURAOS_[A-Z0-9_]+:/g;
    let envVarMatch;

    while ((envVarMatch = envVarPattern.exec(serviceContent)) !== null) {
      envVars.push(envVarMatch[0].replace(':', ''));
    }

    mappings[serviceName] = new Set(envVars);
  }

  return mappings;
}

/**
 * Check a single service for env var violations.
 */
function checkService(serviceName, serviceDir) {
  const indexPath = join(serviceDir, 'src', 'index.ts');

  if (!existsSync(indexPath)) {
    warnings.push(`${serviceName}/: No index.ts found, skipping`);
    return;
  }

  const indexContent = readFileSync(indexPath, 'utf8');
  const requiredEnv = new Set(extractRequiredEnv(indexContent));
  const optionalEnv = COMMON_OPTIONAL_ENV;

  // Find all TypeScript files in the service
  const srcDir = join(serviceDir, 'src');
  const tsFiles = findTsFiles(srcDir);

  // Track all env vars used by the service
  const usedEnvVars = new Map(); // varName -> [{file, line, content}]

  for (const filePath of tsFiles) {
    const content = readFileSync(filePath, 'utf8');
    const accesses = findEnvAccesses(content);
    const relativePath = relative(repoRoot, filePath);

    for (const access of accesses) {
      if (!usedEnvVars.has(access.varName)) {
        usedEnvVars.set(access.varName, []);
      }
      usedEnvVars.get(access.varName).push({
        file: relativePath,
        line: access.line,
        content: access.content,
      });
    }
  }

  // Check for undeclared env vars
  for (const [varName, locations] of usedEnvVars) {
    // Skip standard env vars
    if (STANDARD_ENV_VARS.has(varName)) {
      continue;
    }

    // Check if declared in REQUIRED_ENV or globally optional
    if (requiredEnv.has(varName) || optionalEnv.has(varName)) {
      continue;
    }

    // Report violation
    for (const loc of locations) {
      errors.push(
        `${loc.file}:${loc.line}: Undeclared env var '${varName}' used. ` +
          `Add to REQUIRED_ENV in src/index.ts.`
      );
    }
  }

  // Check if all REQUIRED_ENV vars are in dev.mjs mappings
  const devMappings = parseDevMjsMappings();
  const serviceMappings = devMappings[serviceName];

  if (!serviceMappings) {
    warnings.push(`${serviceName}/: No entry in scripts/dev.mjs SERVICE_ENV_MAPPINGS`);
  } else {
    for (const varName of requiredEnv) {
      // Skip common vars provided by COMMON_SERVICE_ENV and COMMON_SERVICE_URLS
      if (isCommonServiceVar(varName)) {
        continue;
      }

      if (!serviceMappings.has(varName)) {
        errors.push(
          `${serviceName}/src/index.ts: REQUIRED_ENV var '${varName}' not in scripts/dev.mjs SERVICE_ENV_MAPPINGS`
        );
      }
    }
  }
}

/**
 * Check if an env var is provided by common service env/URLs.
 * These vars are set globally (via .envrc, terraform, etc.) and don't need
 * to be in per-service SERVICE_ENV_MAPPINGS.
 */
function isCommonServiceVar(varName) {
  // From dev.mjs COMMON_SERVICE_ENV
  const commonEnv = new Set([
    'INTEXURAOS_AUTH_JWKS_URL',
    'INTEXURAOS_AUTH_ISSUER',
    'INTEXURAOS_AUTH_AUDIENCE',
    'INTEXURAOS_AUTH0_DOMAIN',
    'INTEXURAOS_AUTH0_CLIENT_ID',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'FIREBASE_AUTH_EMULATOR_HOST',
    // Global infrastructure vars (set once, used by all services)
    'INTEXURAOS_GCP_PROJECT_ID',
    'INTEXURAOS_WEB_APP_URL',
    'INTEXURAOS_AUTH0_ISSUER',
    'INTEXURAOS_AUTH0_AUDIENCE',
    'INTEXURAOS_AUTH0_JWKS_URI',
    // Framework-controlled vars (have defaults)
    'PORT',
    'HOST',
    'NODE_ENV',
  ]);

  // From dev.mjs COMMON_SERVICE_URLS (all INTEXURAOS_*_URL vars)
  if (varName.endsWith('_URL') && varName.startsWith('INTEXURAOS_')) {
    return true;
  }

  return commonEnv.has(varName);
}

/**
 * Main verification function.
 */
function main() {
  console.log('Verifying environment variable declarations...\n');

  if (!existsSync(appsDir)) {
    console.log('No apps directory found');
    process.exit(1);
  }

  const services = readdirSync(appsDir).filter((entry) =>
    statSync(join(appsDir, entry)).isDirectory()
  );

  for (const service of services) {
    const serviceDir = join(appsDir, service);
    const indexPath = join(serviceDir, 'src', 'index.ts');

    if (existsSync(indexPath)) {
      console.log(`  Checking ${service}/...`);
      checkService(service, serviceDir);
    }
  }

  console.log('');

  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of warnings) {
      console.log(`  ⚠ ${warning}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.log('Errors:');
    for (const error of errors) {
      console.log(`  ✖ ${error}`);
    }
    console.log('');
    console.log(`Environment variable verification failed with ${String(errors.length)} error(s).`);
    console.log('');
    console.log('To fix:');
    console.log("  1. Add missing vars to REQUIRED_ENV in the service's index.ts");
    console.log('  2. Add service-specific vars to SERVICE_ENV_MAPPINGS in scripts/dev.mjs');
    process.exit(1);
  }

  console.log('✓ All environment variables are properly declared');
}

main();
