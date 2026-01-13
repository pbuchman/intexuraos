#!/usr/bin/env node
/**
 * Logging Standards Verification Script.
 *
 * Ensures factory functions that accept optional logger are called with logger in services.ts
 *
 * Pattern:
 * - Factory functions in infra/ with `logger?: Logger` in config
 * - Should be called with `logger: pino({ name: '...' })` in services.ts
 *
 * Exclusions:
 * - Test files (use defaults or test fakes)
 * - Factory-bound use cases (logger bound at creation, execute() takes no deps)
 * - Runtime-passed pattern (execute(input, { logger }))
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname, basename } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

const errors = [];
const warnings = [];

/**
 * Find all services.ts files in apps.
 */
function findServicesFiles() {
  const files = [];
  const appsDir = join(repoRoot, 'apps');

  if (!existsSync(appsDir)) {
    return files;
  }

  for (const app of readdirSync(appsDir)) {
    const servicesFile = join(appsDir, app, 'src', 'services.ts');
    if (existsSync(servicesFile)) {
      files.push(servicesFile);
    }
  }

  return files;
}

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
 * Extract factory function info from a file that accept logger in config.
 *
 * Returns: { functionName, filePath } tuples for service-scoped checking
 *
 * Pattern: function createXxx(config: XxxConfig { logger?: Logger })
 */
function extractFactoryFunctions(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const functions = [];

  // Match both the interface and function in the same file
  // Pattern: interface XxxConfig { logger?: Logger } followed by export function createXxx(config: XxxConfig)
  const configInterfacePattern = /interface\s+(\w*Config)\s*\{[^}]*logger\?\s*:\s*Logger[^}]*\}/s;
  const configMatch = content.match(configInterfacePattern);

  if (!configMatch) {
    return functions;
  }

  const configName = configMatch[1];

  // Find the factory function that uses this config
  const factoryPattern = new RegExp(
    `export\\s+function\\s+(create\\w+)\\s*\\(\\s*config\\s*:\\s*${configName}\\s*\\)`
  );
  const factoryMatch = content.match(factoryPattern);

  if (factoryMatch) {
    functions.push({
      name: factoryMatch[1],
      filePath,
    });
  }

  return functions;
}

/**
 * Check if a factory call includes logger parameter.
 */
function callIncludesLogger(callContent) {
  // Check if the call object includes logger: ...
  return /logger\s*:\s*pino\s*\(/.test(callContent) ||
         /logger\s*:\s*logger/.test(callContent) ||
         /logger\s*:\s*config\./.test(callContent) ||
         /logger\s*:\s*serviceConfig\./.test(callContent);
}

/**
 * Find factory function calls in a services.ts file and check if logger is passed.
 */
function checkServicesFile(servicesFile, factoryFunctions) {
  const content = readFileSync(servicesFile, 'utf8');
  const relativePath = relative(repoRoot, servicesFile);

  // Extract app name from services file path to scope factory checks
  // apps/xxx-agent/src/services.ts -> xxx-agent
  const appMatch = servicesFile.match(/apps\/([^/]+)\//);
  if (!appMatch) {
    return;
  }
  const appName = appMatch[1];

  // Filter factories to only those in the same app
  const appFactories = factoryFunctions.filter((f) =>
    f.filePath.includes(`/apps/${appName}/`)
  );

  if (appFactories.length === 0) {
    return;
  }

  // For each factory function in this app, check if it's called with logger
  for (const factory of appFactories) {
    // Find all calls to this factory function
    // Pattern: const xxx = factoryName({ or xxx: factoryName({
    const callPattern = new RegExp(
      `(?:const\\s+\\w+\\s*=|\\w+\\s*:)\\s*${factory.name}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`,
      'g'
    );

    const matches = [...content.matchAll(callPattern)];

    for (const match of matches) {
      const callContent = match[1];

      if (!callIncludesLogger(callContent)) {
        // Extract line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        errors.push(
          `${relativePath}:${lineNumber}: ${factory.name}() called without logger parameter`
        );
      }
    }
  }
}

/**
 * Find all factory functions in infra/ that accept logger.
 * Returns array of { name, filePath } objects.
 */
function findAllFactoryFunctions() {
  const functions = [];
  const appsDir = join(repoRoot, 'apps');

  if (!existsSync(appsDir)) {
    return functions;
  }

  for (const app of readdirSync(appsDir)) {
    const infraDirs = [
      join(appsDir, app, 'src', 'infra', 'http'),
      join(appsDir, app, 'src', 'infra'),
    ];

    for (const infraDir of infraDirs) {
      if (existsSync(infraDir)) {
        const files = findTsFiles(infraDir);
        for (const file of files) {
          const fileFunctions = extractFactoryFunctions(file);
          functions.push(...fileFunctions);
        }
      }
    }
  }

  return functions;
}

/**
 * Main verification function.
 */
function main() {
  console.log('Verifying logging standards...\n');

  // Step 1: Find all factory functions that accept logger
  console.log('  Scanning for factory functions with logger parameter...');
  const factoryFunctions = findAllFactoryFunctions();
  console.log(`  Found ${String(factoryFunctions.length)} factory functions\n`);

  if (factoryFunctions.length === 0) {
    console.log('✓ No factory functions with logger parameter found');
    return;
  }

  // Step 2: Check services.ts files for proper logger passing
  console.log('  Checking services.ts files for logger usage...\n');
  const servicesFiles = findServicesFiles();

  for (const servicesFile of servicesFiles) {
    checkServicesFile(servicesFile, factoryFunctions);
  }

  console.log('');

  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of warnings) {
      console.log(`  ${warning}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.log('Errors:');
    for (const error of errors) {
      console.log(`  ${error}`);
    }
    console.log('');
    console.log(`Logging verification failed with ${String(errors.length)} error(s).`);
    console.log('');
    console.log('Factory functions that accept logger should be called with:');
    console.log('  logger: pino({ name: "serviceName" })');
    process.exit(1);
  }

  console.log('✓ Logging standards verified');
}

main();
