#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
const ROUTE_CALL_RE = new RegExp(
  '\\b(?:fastify|app)\\.(?:' +
    HTTP_METHODS.join('|') +
    ')\\s*(?:<[\\s\\S]*?>)?\\(\\s*([\'"`])([^\'"`$]+)\\1',
  'g'
);
const ROUTE_OBJECT_RE =
  /\b(?:fastify|app)\.route\s*\(\s*\{[\s\S]*?\b(?:url|path)\s*:\s*(['"`])([^'"`${}]+)\1/g;
const FRONTEND_CALL_RE =
  /(?:apiRequest|request|fetchJson|sendRequest)\s*(?:<[\s\S]*?>)?\(\s*config\.([A-Za-z0-9_]+)\s*,\s*(['"`])([^'"`$]+)(?:\2|\$\{)/g;
const FRONTEND_CONFIG_URL_TEMPLATE_RE = /`\$\{config\.([A-Za-z0-9_]+)\}([^`$]*)/g;
const E2E_DIRECT_CALL_RE = new RegExp(
  '\\bclient\\.(?:' +
    HTTP_METHODS.join('|') +
    ')\\s*(?:<[\\s\\S]*?>)?\\(\\s*([\'"`])([^\'"`$]+)(?:\\1|\\$\\{)',
  'g'
);
const CONFIG_MAPPING_RE = /\b([A-Za-z0-9_]+)\s*:\s*serviceUrls\.(INTEXURAOS_[A-Z0-9_]+_URL)\b/g;
const ACTION_CONFIG_ENDPOINT_RE =
  /\bpath:\s*(\/[^\s#]+)[\s\S]*?\bbaseUrl:\s*\$\{(INTEXURAOS_[A-Z0-9_]+_URL)\}/g;

const IGNORED_ROUTES = new Set(['/health', '/openapi.json', '/docs']);
const ALIAS_RESOURCE_SEGMENTS = new Map([
  ['mobile-notifications-service', ['mobile-notifications', 'notifications']],
  ['fishing-assistant-service', ['fishing']],
  ['cron-agent', ['cron']],
  ['hellscript-agent', ['hellscript']],
]);

function parseArgs(argv) {
  const args = argv.slice(2);
  let root = resolve(import.meta.dirname, '..');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.length === 0 || next.startsWith('--')) {
        throw new Error('--root requires a directory argument');
      }
      root = resolve(next);
      i++;
    }
  }

  return { root };
}

function loadManifest(root) {
  const manifestPath = resolve(root, 'apps/web/service-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.services)) {
    throw new Error('Manifest must have a "services" array');
  }

  return parsed.services;
}

function apiPathResourceSegment(apiPath) {
  const parts = apiPath.split('/').filter(Boolean);
  if (parts[0] !== 'api' || typeof parts[1] !== 'string') {
    throw new Error(`Manifest apiPath must start with /api/<resource>: ${apiPath}`);
  }
  return parts[1];
}

function kebabToCamel(value) {
  return value.replace(/-([a-z0-9])/g, (_match, char) => String(char).toUpperCase());
}

function configPropertyFallbacks(service) {
  const base = kebabToCamel(service.name);
  const withoutService = service.name.endsWith('-service')
    ? kebabToCamel(service.name.slice(0, -'-service'.length))
    : base;

  return new Set([
    `${base}Url`,
    `${base}ServiceUrl`,
    `${withoutService}Url`,
    `${withoutService}ServiceUrl`,
    `${kebabToCamel(apiPathResourceSegment(service.apiPath))}Url`,
  ]);
}

function buildServiceChecks(services, root) {
  const byName = new Map();
  const byConfigProperty = new Map();
  const envToService = new Map();

  for (const service of services) {
    if (typeof service.name !== 'string' || typeof service.apiPath !== 'string') {
      continue;
    }

    const resourceSegments = new Set([
      apiPathResourceSegment(service.apiPath),
      ...(ALIAS_RESOURCE_SEGMENTS.get(service.name) ?? []),
    ]);
    const check = { service, resourceSegments };
    byName.set(service.name, check);

    if (typeof service.envSuffix === 'string') {
      envToService.set(`INTEXURAOS_${service.envSuffix}_URL`, check);
    }

    for (const property of configPropertyFallbacks(service)) {
      byConfigProperty.set(property, check);
    }
  }

  const configPath = resolve(root, 'apps/web/src/config.ts');
  if (existsSync(configPath)) {
    const source = readFileSync(configPath, 'utf8');
    let match;
    while ((match = CONFIG_MAPPING_RE.exec(source)) !== null) {
      const property = match[1];
      const envVar = match[2];
      const check = envToService.get(envVar);
      if (check !== undefined) {
        byConfigProperty.set(property, check);
      }
    }
  }

  return { byName, byConfigProperty, byEnvVar: envToService };
}

function lineNumberOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

function walk(dir, out, extensions) {
  if (!existsSync(dir)) {
    return;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (entry === '__tests__' || entry === 'dist' || entry === 'node_modules') {
        continue;
      }
      walk(fullPath, out, extensions);
      continue;
    }

    if (extensions.some((extension) => entry.endsWith(extension))) {
      out.push(fullPath);
    }
  }
}

function findRouteFiles(root) {
  const files = [];
  const appsDir = resolve(root, 'apps');
  if (!existsSync(appsDir)) {
    return files;
  }

  for (const appName of readdirSync(appsDir)) {
    if (appName === 'web') {
      continue;
    }

    const srcDir = resolve(appsDir, appName, 'src');
    if (existsSync(srcDir)) {
      walk(srcDir, files, ['.ts']);
    }
  }

  return files.filter((file) => !file.endsWith('.d.ts') && !file.endsWith('.test.ts'));
}

function findFrontendFiles(root) {
  const files = [];
  walk(resolve(root, 'apps/web/src'), files, ['.ts', '.tsx', '.yaml']);

  const actionConfigPath = resolve(root, 'apps/web/src/config/action-config.yaml');
  if (existsSync(actionConfigPath) && !files.includes(actionConfigPath)) {
    files.push(actionConfigPath);
  }

  return files.filter((file) => !file.endsWith('.d.ts') && !file.endsWith('.test.ts'));
}

function findE2eFiles(root) {
  const files = [];
  walk(resolve(root, 'e2e'), files, ['.ts', '.tsx']);
  return files.filter((file) => !file.endsWith('.d.ts'));
}

function isIgnoredRoute(routePath) {
  return IGNORED_ROUTES.has(routePath) || routePath.startsWith('/internal/');
}

function startsWithResource(routePath, resourceSegment) {
  return routePath === `/${resourceSegment}` || routePath.startsWith(`/${resourceSegment}/`);
}

function findDuplicatedResource(routePath, resourceSegments) {
  for (const resourceSegment of resourceSegments) {
    if (startsWithResource(routePath, resourceSegment)) {
      return resourceSegment;
    }
  }
  return null;
}

function scanRouteFile(filePath, root, checksByName) {
  const appName = relative(resolve(root, 'apps'), filePath).split('/')[0];
  const check = checksByName.get(appName);
  if (check === undefined) {
    return [];
  }

  const source = readFileSync(filePath, 'utf8');
  const violations = [];

  for (const regex of [ROUTE_CALL_RE, ROUTE_OBJECT_RE]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source)) !== null) {
      const routePath = match[2];
      if (typeof routePath !== 'string' || isIgnoredRoute(routePath)) {
        continue;
      }

      const duplicated = findDuplicatedResource(routePath, check.resourceSegments);
      if (duplicated === null) {
        continue;
      }

      violations.push(
        `${relative(root, filePath)}:${String(lineNumberOf(source, match.index))}: ${appName} public route "${routePath}" repeats mounted resource segment "/${duplicated}"`
      );
    }
  }

  return violations;
}

function scanActionConfigFile(filePath, root, checksByEnvVar) {
  const source = readFileSync(filePath, 'utf8');
  const violations = [];

  ACTION_CONFIG_ENDPOINT_RE.lastIndex = 0;
  let match;
  while ((match = ACTION_CONFIG_ENDPOINT_RE.exec(source)) !== null) {
    const requestPath = match[1];
    const envVar = match[2];
    const check = checksByEnvVar.get(envVar);
    if (check === undefined || typeof requestPath !== 'string' || isIgnoredRoute(requestPath)) {
      continue;
    }

    const duplicated = findDuplicatedResource(requestPath, check.resourceSegments);
    if (duplicated === null) {
      continue;
    }

    violations.push(
      `${relative(root, filePath)}:${String(lineNumberOf(source, match.index))}: action-config endpoint ${envVar} path "${requestPath}" repeats mounted resource segment "/${duplicated}"`
    );
  }

  return violations;
}

function scanFrontendFile(filePath, root, checksByConfigProperty, checksByEnvVar) {
  if (filePath.endsWith('.yaml')) {
    return scanActionConfigFile(filePath, root, checksByEnvVar);
  }

  const source = readFileSync(filePath, 'utf8');
  const violations = [];

  FRONTEND_CALL_RE.lastIndex = 0;
  let match;
  while ((match = FRONTEND_CALL_RE.exec(source)) !== null) {
    const configProperty = match[1];
    const requestPath = match[3];
    const check = checksByConfigProperty.get(configProperty);
    if (check === undefined || typeof requestPath !== 'string' || isIgnoredRoute(requestPath)) {
      continue;
    }

    const duplicated = findDuplicatedResource(requestPath, check.resourceSegments);
    if (duplicated === null) {
      continue;
    }

    violations.push(
      `${relative(root, filePath)}:${String(lineNumberOf(source, match.index))}: frontend call config.${configProperty} path "${requestPath}" repeats mounted resource segment "/${duplicated}"`
    );
  }

  FRONTEND_CONFIG_URL_TEMPLATE_RE.lastIndex = 0;
  while ((match = FRONTEND_CONFIG_URL_TEMPLATE_RE.exec(source)) !== null) {
    const configProperty = match[1];
    const requestPath = match[2];
    const check = checksByConfigProperty.get(configProperty);
    if (check === undefined || typeof requestPath !== 'string' || isIgnoredRoute(requestPath)) {
      continue;
    }

    const duplicated = findDuplicatedResource(requestPath, check.resourceSegments);
    if (duplicated === null) {
      continue;
    }

    violations.push(
      `${relative(root, filePath)}:${String(lineNumberOf(source, match.index))}: frontend URL config.${configProperty} path "${requestPath}" repeats mounted resource segment "/${duplicated}"`
    );
  }

  return violations;
}

function scanE2eFile(filePath, root, codeAgentCheck) {
  if (codeAgentCheck === undefined) {
    return [];
  }

  const source = readFileSync(filePath, 'utf8');
  const violations = [];

  E2E_DIRECT_CALL_RE.lastIndex = 0;
  let match;
  while ((match = E2E_DIRECT_CALL_RE.exec(source)) !== null) {
    const requestPath = match[2];
    if (typeof requestPath !== 'string' || isIgnoredRoute(requestPath)) {
      continue;
    }

    const duplicated = findDuplicatedResource(requestPath, codeAgentCheck.resourceSegments);
    if (duplicated === null) {
      continue;
    }

    violations.push(
      `${relative(root, filePath)}:${String(lineNumberOf(source, match.index))}: e2e code-agent call path "${requestPath}" repeats mounted resource segment "/${duplicated}"`
    );
  }

  return violations;
}

function main() {
  try {
    const { root } = parseArgs(process.argv);
    const services = loadManifest(root);
    const { byName, byConfigProperty, byEnvVar } = buildServiceChecks(services, root);
    const routeFiles = findRouteFiles(root);
    const frontendFiles = findFrontendFiles(root);
    const e2eFiles = findE2eFiles(root);

    const violations = [
      ...routeFiles.flatMap((filePath) => scanRouteFile(filePath, root, byName)),
      ...frontendFiles.flatMap((filePath) =>
        scanFrontendFile(filePath, root, byConfigProperty, byEnvVar)
      ),
      ...e2eFiles.flatMap((filePath) => scanE2eFile(filePath, root, byName.get('code-agent'))),
    ];

    if (violations.length > 0) {
      console.error('Route resource name verification failed:');
      for (const violation of violations) {
        console.error(`  - ${violation}`);
      }
      process.exit(1);
    }

    console.log(
      `✓ Route resource names valid (${String(routeFiles.length)} route files, ${String(frontendFiles.length)} frontend files, ${String(e2eFiles.length)} e2e files scanned)`
    );
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename ?? '');

if (invokedDirectly) {
  main();
}

export {
  buildServiceChecks,
  findDuplicatedResource,
  findE2eFiles,
  findFrontendFiles,
  findRouteFiles,
  parseArgs,
  scanActionConfigFile,
  scanE2eFile,
  scanFrontendFile,
  scanRouteFile,
};
