#!/usr/bin/env node
/**
 * Detect affected services based on git diff.
 *
 * Rules:
 * - packages/common/** affects all services
 * - apps/<service>/** affects that service (owns domain + infra)
 *
 * Output: /workspace/affected.json
 * Format: {
 *   "services": ["auth-service", "promptvault-service", "whatsapp-service", "api-docs-hub"]
 * }
 */

import { execSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';
const OUTPUT_FILE = join(WORKSPACE, 'affected.json');

// Service dependencies - each app owns its domain and infra
// terraform/ changes affect all services (infrastructure changes require redeploy)
// cloudbuild/ changes affect all services (build/deploy logic changes require redeploy)
const SERVICE_DEPS = {
  'auth-service': [
    'apps/auth-service/',
    'packages/common/',
    'terraform/',
    'cloudbuild/',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.base.json',
  ],
  'promptvault-service': [
    'apps/promptvault-service/',
    'packages/common/',
    'terraform/',
    'cloudbuild/',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.base.json',
  ],
  'notion-service': [
    'apps/notion-service/',
    'packages/common/',
    'terraform/',
    'cloudbuild/',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.base.json',
  ],
  'whatsapp-service': [
    'apps/whatsapp-service/',
    'packages/common/',
    'terraform/',
    'cloudbuild/',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.base.json',
  ],
  'api-docs-hub': [
    'apps/api-docs-hub/',
    'packages/common/',
    'terraform/',
    'cloudbuild/',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.base.json',
  ],
  web: [
    'apps/web/',
    'terraform/',
    'cloudbuild/',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.base.json',
  ],
};

/**
 * Get the git diff range.
 */
function getDiffRange() {
  const commitSha = process.env.COMMIT_SHA;

  if (commitSha) {
    // In Cloud Build, compare with previous commit
    try {
      execSync('git fetch --depth=2 origin', { stdio: 'pipe' });
      return `${commitSha}~1..${commitSha}`;
    } catch {
      console.log('Could not fetch previous commit, comparing with HEAD~1');
      return 'HEAD~1..HEAD';
    }
  }

  // Local fallback
  return 'HEAD~1..HEAD';
}

/**
 * Get list of changed files.
 */
function getChangedFiles(diffRange) {
  try {
    const output = execSync(`git diff --name-only ${diffRange}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
  } catch (error) {
    console.error('Error getting changed files:', error.message);
    // If git diff fails, assume all services are affected
    return ['packages/common/'];
  }
}

/**
 * Determine which services are affected by the changed files.
 */
function getAffectedServices(changedFiles) {
  const affected = new Set();

  for (const file of changedFiles) {
    for (const [service, deps] of Object.entries(SERVICE_DEPS)) {
      for (const dep of deps) {
        if (file.startsWith(dep) || file === dep.replace(/\/$/, '')) {
          affected.add(service);
          break;
        }
      }
    }
  }

  return Array.from(affected).sort();
}

/**
 * Main entry point.
 */
function main() {
  console.log('=== Detecting Affected Services ===');
  console.log(`COMMIT_SHA: ${process.env.COMMIT_SHA || 'not set'}`);
  console.log(`BRANCH_NAME: ${process.env.BRANCH_NAME || 'not set'}`);
  console.log(`Output file: ${OUTPUT_FILE}`);

  const diffRange = getDiffRange();
  console.log(`Diff range: ${diffRange}`);

  const changedFiles = getChangedFiles(diffRange);
  console.log(`Changed files (${changedFiles.length}):`);
  for (const file of changedFiles.slice(0, 20)) {
    console.log(`  - ${file}`);
  }
  if (changedFiles.length > 20) {
    console.log(`  ... and ${changedFiles.length - 20} more`);
  }

  const affectedServices = getAffectedServices(changedFiles);
  console.log(`\nAffected services: ${affectedServices.join(', ') || 'none'}`);

  const output = {
    services: affectedServices,
    changedFilesCount: changedFiles.length,
    diffRange,
    timestamp: new Date().toISOString(),
  };

  // Ensure workspace directory exists (for local testing)
  if (!existsSync(WORKSPACE)) {
    console.log(`Workspace directory does not exist, using current directory`);
    writeFileSync('./affected.json', JSON.stringify(output, null, 2));
    console.log(`Written to: ./affected.json`);
  } else {
    writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`Written to: ${OUTPUT_FILE}`);
  }

  console.log('\n=== Detection Complete ===');
}

main();
