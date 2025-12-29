#!/usr/bin/env node
/**
 * Detect affected services based on git diff.
 *
 * Rules:
 * - packages/common/** affects all services
 * - apps/<service>/** affects that service (owns domain + infra)
 *
 * Comparison strategy:
 * - Compares with the last SUCCESSFUL Cloud Build commit (not just HEAD~1)
 * - This ensures failed builds don't cause changes to be skipped
 * - Falls back to HEAD~1 if no successful build found or API unavailable
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
const PROJECT_ID = process.env.PROJECT_ID || process.env.GCLOUD_PROJECT;
const BRANCH_NAME = process.env.BRANCH_NAME || 'development';

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
  'mobile-notifications-service': [
    'apps/mobile-notifications-service/',
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
 * Get the commit SHA of the last successful Cloud Build.
 * Uses gcloud CLI to query Cloud Build API.
 *
 * @returns {string|null} Commit SHA or null if not found
 */
function getLastSuccessfulBuildCommit() {
  if (!PROJECT_ID) {
    console.log('PROJECT_ID not set, cannot query Cloud Build API');
    return null;
  }

  try {
    // Query for the last successful build on this branch (excluding current build)
    // Filter: status=SUCCESS, source.repoSource.branchName matches, sorted by createTime desc
    const result = execSync(
      `gcloud builds list \
        --project="${PROJECT_ID}" \
        --filter="status=SUCCESS AND substitutions._BRANCH_NAME=${BRANCH_NAME}" \
        --sort-by="~createTime" \
        --limit=1 \
        --format="value(substitutions.COMMIT_SHA)"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result && result.length === 40) {
      console.log(`Found last successful build commit: ${result}`);
      return result;
    }

    console.log('No successful build found via gcloud, will use fallback');
    return null;
  } catch (error) {
    console.log(`Could not query Cloud Build API: ${error.message}`);
    return null;
  }
}

/**
 * Get the git diff range.
 * Compares current commit with last successful build.
 * Returns null if no comparison base found (triggers full rebuild).
 *
 * @returns {string|null} Diff range or null for full rebuild
 */
function getDiffRange() {
  const commitSha = process.env.COMMIT_SHA;

  if (commitSha) {
    // Try to get last successful build commit
    const lastSuccessCommit = getLastSuccessfulBuildCommit();

    if (lastSuccessCommit && lastSuccessCommit !== commitSha) {
      // Fetch enough history to include the last successful commit
      try {
        execSync(`git fetch --depth=100 origin ${BRANCH_NAME}`, { stdio: 'pipe' });
        // Verify the commit exists in our history
        execSync(`git cat-file -e ${lastSuccessCommit}`, { stdio: 'pipe' });
        console.log(`Comparing with last successful build: ${lastSuccessCommit}`);
        return `${lastSuccessCommit}..${commitSha}`;
      } catch {
        console.log('Could not find last successful commit in history, fetching more...');
        try {
          execSync(`git fetch --unshallow origin ${BRANCH_NAME} || git fetch --depth=500 origin ${BRANCH_NAME}`, { stdio: 'pipe' });
          execSync(`git cat-file -e ${lastSuccessCommit}`, { stdio: 'pipe' });
          console.log(`Comparing with last successful build: ${lastSuccessCommit}`);
          return `${lastSuccessCommit}..${commitSha}`;
        } catch {
          console.log('Still could not find commit in history');
        }
      }
    }

    // No valid comparison base - trigger full rebuild
    console.log('No successful build baseline found - will rebuild ALL services');
    return null;
  }

  // Local fallback - use HEAD~1 for local testing only
  console.log('Local mode: comparing with HEAD~1');
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
  console.log(`PROJECT_ID: ${PROJECT_ID || 'not set'}`);
  console.log(`Output file: ${OUTPUT_FILE}`);

  const diffRange = getDiffRange();

  let changedFiles;
  let affectedServices;

  if (diffRange === null) {
    // No baseline - rebuild everything
    console.log('Full rebuild triggered - all services affected');
    changedFiles = ['<full-rebuild>'];
    affectedServices = Object.keys(SERVICE_DEPS).sort();
  } else {
    console.log(`Diff range: ${diffRange}`);
    changedFiles = getChangedFiles(diffRange);
    console.log(`Changed files (${changedFiles.length}):`);
    for (const file of changedFiles.slice(0, 20)) {
      console.log(`  - ${file}`);
    }
    if (changedFiles.length > 20) {
      console.log(`  ... and ${changedFiles.length - 20} more`);
    }
    affectedServices = getAffectedServices(changedFiles);
  }

  console.log(`\nAffected services: ${affectedServices.join(', ') || 'none'}`);

  const output = {
    services: affectedServices,
    changedFilesCount: changedFiles.length,
    diffRange: diffRange || 'full-rebuild',
    fullRebuild: diffRange === null,
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
