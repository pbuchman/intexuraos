#!/usr/bin/env node
/**
 * Check if a specific target is affected by changes.
 *
 * Derives dependencies from package.json for services, with special handling
 * for non-service targets (web, firestore).
 *
 * Usage: node check-affected.mjs <target-name>
 * Exit codes:
 *   0 = affected (should build/deploy)
 *   1 = not affected (skip)
 *
 * Comparison strategy:
 * - Compares with the last SUCCESSFUL Cloud Build commit (not just HEAD~1)
 * - Falls back to full rebuild if no successful build found
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';
const PROJECT_ID = process.env.PROJECT_ID || process.env.GCLOUD_PROJECT;
const BRANCH_NAME = process.env.BRANCH_NAME || 'development';

const COMMON_DEPS = [
  'terraform/',
  'cloudbuild/',
  'scripts/',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.base.json',
];

const SPECIAL_TARGETS = {
  web: ['apps/web/'],
  firestore: ['firebase.json', 'migrations/', 'scripts/migrate.mjs'],
};

/**
 * Get watch paths for a target.
 * For services: derives from package.json workspace dependencies.
 * For special targets: uses hardcoded paths.
 */
function getWatchPaths(target) {
  if (SPECIAL_TARGETS[target]) {
    return [...SPECIAL_TARGETS[target], ...COMMON_DEPS];
  }

  const packageJsonPath = join(WORKSPACE, 'apps', target, 'package.json');

  if (!existsSync(packageJsonPath)) {
    console.error(`ERROR: No package.json found for target '${target}' at ${packageJsonPath}`);
    process.exit(0);
  }

  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  const workspaceDeps = Object.keys(allDeps)
    .filter((dep) => dep.startsWith('@intexuraos/'))
    .map((dep) => `packages/${dep.replace('@intexuraos/', '')}/`);

  return [`apps/${target}/`, ...workspaceDeps, ...COMMON_DEPS];
}

/**
 * Get the commit SHA of the last successful Cloud Build.
 */
function getLastSuccessfulBuildCommit() {
  if (!PROJECT_ID) {
    console.log('PROJECT_ID not set, cannot query Cloud Build API');
    return null;
  }

  try {
    let accessToken;
    try {
      accessToken = execSync(
        'curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" | grep -o \'"access_token":"[^"]*\' | cut -d\'"\' -f4',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
      ).trim();
    } catch {
      console.log('Could not get access token (expected locally)');
      return null;
    }

    if (!accessToken) {
      return null;
    }

    const REGION = process.env.REGION || 'europe-west1';
    const filter = encodeURIComponent(`status="SUCCESS"`);
    const apiUrl = `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/builds?filter=${filter}&pageSize=10`;

    const response = execSync(`curl -s -H "Authorization: Bearer ${accessToken}" "${apiUrl}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });

    let data;
    try {
      data = JSON.parse(response);
    } catch {
      return null;
    }

    if (data.error || !data.builds || data.builds.length === 0) {
      return null;
    }

    const currentCommit = process.env.COMMIT_SHA;

    for (const build of data.builds) {
      const buildCommit = build.substitutions?.COMMIT_SHA;
      const buildBranch = build.substitutions?.BRANCH_NAME;

      if (buildCommit === currentCommit) continue;
      if (buildBranch && buildBranch !== BRANCH_NAME) continue;

      if (buildCommit && buildCommit.length === 40) {
        console.log(`Found last successful build: ${buildCommit}`);
        return buildCommit;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get the git diff range.
 */
function getDiffRange() {
  const commitSha = process.env.COMMIT_SHA;

  if (commitSha) {
    const lastSuccessCommit = getLastSuccessfulBuildCommit();

    if (lastSuccessCommit && lastSuccessCommit !== commitSha) {
      try {
        execSync(`git fetch --depth=100 origin ${BRANCH_NAME}`, { stdio: 'pipe' });
        execSync(`git cat-file -e ${lastSuccessCommit}`, { stdio: 'pipe' });
        return `${lastSuccessCommit}..${commitSha}`;
      } catch {
        try {
          execSync(
            `git fetch --unshallow origin ${BRANCH_NAME} || git fetch --depth=500 origin ${BRANCH_NAME}`,
            { stdio: 'pipe' }
          );
          execSync(`git cat-file -e ${lastSuccessCommit}`, { stdio: 'pipe' });
          return `${lastSuccessCommit}..${commitSha}`;
        } catch {
          // Fall through to full rebuild
        }
      }
    }

    console.log('No baseline found - full rebuild');
    return null;
  }

  console.log('Local mode: HEAD~1..HEAD');
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
  } catch {
    return [];
  }
}

/**
 * Check if target is affected by changed files.
 */
function isAffected(target, changedFiles, watchPaths) {
  for (const file of changedFiles) {
    for (const path of watchPaths) {
      if (file.startsWith(path) || file === path.replace(/\/$/, '')) {
        console.log(`  Match: ${file} → ${path}`);
        return true;
      }
    }
  }
  return false;
}

const ALL_SERVICES = [
  'user-service',
  'promptvault-service',
  'notion-service',
  'whatsapp-service',
  'api-docs-hub',
  'mobile-notifications-service',
  'llm-orchestrator',
  'commands-router',
  'actions-agent',
  'data-insights-service',
  'image-service',
  'web',
  'firestore',
];

/**
 * Check all services and create marker files for affected ones.
 * Much more efficient than calling the script 13 times.
 */
function checkAllAndCreateMarkers() {
  const markerDir = join(WORKSPACE, '.affected');

  try {
    mkdirSync(markerDir, { recursive: true });
  } catch {
    // Already exists
  }

  console.log('=== Checking all services ===');

  const diffRange = getDiffRange();
  const isFullRebuild = diffRange === null;

  let changedFiles = [];
  if (!isFullRebuild) {
    console.log(`Diff range: ${diffRange}`);
    changedFiles = getChangedFiles(diffRange);
    console.log(`Changed files: ${changedFiles.length}`);
    for (const f of changedFiles.slice(0, 20)) {
      console.log(`  ${f}`);
    }
    if (changedFiles.length > 20) {
      console.log(`  ... and ${changedFiles.length - 20} more`);
    }
  }

  const affected = [];
  const notAffected = [];

  for (const target of ALL_SERVICES) {
    if (isFullRebuild) {
      affected.push(target);
      writeFileSync(join(markerDir, target), '');
    } else {
      const watchPaths = getWatchPaths(target);
      if (isAffected(target, changedFiles, watchPaths)) {
        affected.push(target);
        writeFileSync(join(markerDir, target), '');
      } else {
        notAffected.push(target);
      }
    }
  }

  console.log('\n=== Results ===');
  if (isFullRebuild) {
    console.log('Full rebuild triggered - all services affected');
  }
  console.log(`Affected (${affected.length}): ${affected.join(', ') || '(none)'}`);
  console.log(`Not affected (${notAffected.length}): ${notAffected.join(', ') || '(none)'}`);
  console.log(`\nMarker files created in ${markerDir}/`);
}

/**
 * Check single target (legacy mode).
 */
function checkSingleTarget(target) {
  console.log(`=== Checking if '${target}' is affected ===`);

  const watchPaths = getWatchPaths(target);
  console.log(`Watch paths (${watchPaths.length}):`);
  for (const p of watchPaths.slice(0, 10)) {
    console.log(`  - ${p}`);
  }
  if (watchPaths.length > 10) {
    console.log(`  ... and ${watchPaths.length - 10} more`);
  }

  const diffRange = getDiffRange();

  if (diffRange === null) {
    console.log(`✓ ${target} is AFFECTED (full rebuild)`);
    process.exit(0);
  }

  console.log(`Diff range: ${diffRange}`);
  const changedFiles = getChangedFiles(diffRange);
  console.log(`Changed files: ${changedFiles.length}`);

  if (isAffected(target, changedFiles, watchPaths)) {
    console.log(`✓ ${target} is AFFECTED`);
    process.exit(0);
  } else {
    console.log(`✗ ${target} is NOT affected`);
    process.exit(1);
  }
}

/**
 * Main entry point.
 */
async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.error('Usage: check-affected.mjs <target-name>');
    console.error('       check-affected.mjs --all');
    process.exit(1);
  }

  if (arg === '--all') {
    await checkAllAndCreateMarkers();
  } else {
    checkSingleTarget(arg);
  }
}

main();
