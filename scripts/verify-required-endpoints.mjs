#!/usr/bin/env node
/**
 * Required Endpoints Verification
 *
 * Ensures all apps (except exemptions) have /openapi.json, /health, /docs.
 *
 * Algorithm:
 * 1. Get all apps in /apps/ (exclude api-docs-hub, web)
 * 2. For each app, read src/server.ts
 * 3. Check for endpoint patterns (direct routes or swagger plugins)
 * 4. Report missing endpoints with remediation steps
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const appsDir = join(repoRoot, 'apps');

const REQUIRED_ENDPOINTS = [
  { path: '/openapi.json', method: 'GET' },
  { path: '/health', method: 'GET' },
  { path: '/docs', method: 'GET' },
];

const EXEMPT_APPS = ['api-docs-hub', 'web', 'commands-router', 'llm-orchestrator'];

function getApps() {
  return readdirSync(appsDir).filter((entry) => {
    if (/[*?[\]]/.test(entry)) return false;
    const fullPath = join(appsDir, entry);
    return statSync(fullPath).isDirectory() && !EXEMPT_APPS.includes(entry);
  });
}

function checkServerFile(appName) {
  const serverPath = join(appsDir, appName, 'src', 'server.ts');
  const distPath = join(appsDir, appName, 'dist', 'index.js');

  try {
    let content = '';
    let exists = false;

    if (statSync(serverPath).isFile()) {
      content = readFileSync(serverPath, 'utf8');
      exists = true;
    } else if (statSync(distPath).isFile()) {
      content = readFileSync(distPath, 'utf8');
      exists = true;
    }

    const missingEndpoints = [];

    for (const { path, method } of REQUIRED_ENDPOINTS) {
      const directPattern = new RegExp(
        `app\\.(${method.toLowerCase()})\\s*\\(\\s*['"\`]${path.replace('/', '\\/')}['"\`]`,
        'i'
      );

      const pluginPatterns = {
        '/openapi.json': /app\.swagger\(\)|fastifySwagger/,
        '/docs': /fastifySwaggerUi.*routePrefix.*\/docs/s,
      };

      const hasEndpoint =
        directPattern.test(content) ||
        (pluginPatterns[path] !== undefined && pluginPatterns[path].test(content));

      if (!hasEndpoint) {
        missingEndpoints.push(`${method} ${path}`);
      }
    }

    return { exists: true, missing: missingEndpoints };
  } catch {
    return { exists: false, missing: [] };
  }
}

// Main execution
console.log('Verifying required endpoints...\n');

const apps = getApps();
console.log(`✓ Found ${String(apps.length)} service(s) to check`);

const violations = [];
for (const app of apps) {
  const { exists, missing } = checkServerFile(app);

  if (!exists || missing.length > 0) {
    violations.push({
      app,
      issue: 'Missing server.ts file',
      missing: REQUIRED_ENDPOINTS.map((e) => `${e.method} ${e.path}`),
    });
  } else if (missing.length > 0) {
    violations.push({ app, issue: 'Missing endpoints', missing });
  }
}

if (violations.length === 0) {
  console.log(`✓ All ${apps.length} services have required endpoints`);
  process.exit(0);
}

console.error('❌ MISSING REQUIRED ENDPOINTS\n');
for (const { app, issue, missing } of violations) {
  console.error(`  ${app}:`);
  console.error(`    Issue: ${issue}`);
  for (const endpoint of missing) {
    console.error(`      - ${endpoint}`);
  }
  console.error('');
}

console.error('REQUIREMENTS:');
console.error('  - GET /openapi.json — OpenAPI specification');
console.error('  - GET /health — Health check endpoint');
console.error('  - GET /docs — Swagger UI documentation\n');
process.exit(1);
