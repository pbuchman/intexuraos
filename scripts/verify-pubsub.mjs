#!/usr/bin/env node
/**
 * Pub/Sub Standards Verification Script.
 *
 * Ensures all Pub/Sub publishers extend BasePubSubPublisher.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

const errors = [];
const warnings = [];

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
 * Check if a file contains a class that extends BasePubSubPublisher.
 */
function checkPublisherFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const relativePath = relative(repoRoot, filePath);

  // Skip index files and config files
  const fileName = basename(filePath);
  if (fileName === 'index.ts' || fileName === 'config.ts') {
    return;
  }

  // Check if file defines a publisher class
  const hasPublisherClass =
    /class\s+\w*Publisher/i.test(content) && /publish\w+.*Promise/i.test(content);

  if (!hasPublisherClass) {
    return;
  }

  // Check if it imports from infra-pubsub
  const importsInfraPubsub = /@intexuraos\/infra-pubsub/.test(content);

  // Check if it extends BasePubSubPublisher
  const extendsBase = /extends\s+BasePubSubPublisher/i.test(content);

  if (hasPublisherClass && !extendsBase) {
    errors.push(`${relativePath}: Publisher class does not extend BasePubSubPublisher`);
  }

  if (hasPublisherClass && !importsInfraPubsub) {
    errors.push(`${relativePath}: Publisher does not import from @intexuraos/infra-pubsub`);
  }

  // Check for hardcoded topic names
  const hardcodedTopicPattern = /['"`]intexuraos-[a-z-]+-(dev|prod|staging)['"`]/g;
  const matches = content.match(hardcodedTopicPattern);

  if (matches !== null) {
    for (const match of matches) {
      errors.push(`${relativePath}: Hardcoded topic name found: ${match}`);
    }
  }

  // Check for direct PubSub instantiation
  const directPubSubPattern = /new\s+PubSub\s*\(/;
  if (directPubSubPattern.test(content) && !extendsBase) {
    warnings.push(
      `${relativePath}: Direct PubSub instantiation - consider extending BasePubSubPublisher`
    );
  }
}

/**
 * Main verification function.
 */
function main() {
  console.log('Verifying Pub/Sub standards...\n');

  const appsDir = join(repoRoot, 'apps');

  if (!existsSync(appsDir)) {
    console.log('No apps directory found');
    process.exit(1);
  }

  for (const app of readdirSync(appsDir)) {
    const pubsubDir = join(appsDir, app, 'src', 'infra', 'pubsub');

    if (existsSync(pubsubDir)) {
      console.log(`  Checking ${app}/src/infra/pubsub/...`);

      const files = findTsFiles(pubsubDir);
      for (const file of files) {
        checkPublisherFile(file);
      }
    }
  }

  // Also check packages/infra-pubsub
  const infraPubsub = join(repoRoot, 'packages', 'infra-pubsub', 'src');
  if (existsSync(infraPubsub)) {
    console.log('  Checking packages/infra-pubsub/src/...');

    const files = findTsFiles(infraPubsub);
    for (const file of files) {
      const fileName = basename(file);
      if (fileName === 'basePublisher.ts' || fileName === 'types.ts') {
        continue;
      }
      checkPublisherFile(file);
    }
  }

  console.log('');

  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of warnings) {
      console.log(`   ${warning}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.log('Errors:');
    for (const error of errors) {
      console.log(`   ${error}`);
    }
    console.log('');
    console.log(`Pub/Sub verification failed with ${String(errors.length)} error(s).`);
    process.exit(1);
  }

  console.log('Pub/Sub standards verified successfully!');
}

main();
