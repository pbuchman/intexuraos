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
 *   "services": ["user-service", "promptvault-service", "whatsapp-service", "api-docs-hub"]
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
  'user-service': [
    'apps/user-service/',
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
  'llm-orchestrator-service': [
    'apps/llm-orchestrator-service/',
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
 * Uses Cloud Build REST API via curl (available in node:22 image).
 *
 * @returns {string|null} Commit SHA or null if not found
 */
function getLastSuccessfulBuildCommit() {
  if (!PROJECT_ID) {
    console.log('PROJECT_ID not set, cannot query Cloud Build API');
    return null;
  }

  console.log(`Attempting to query Cloud Build API for project: ${PROJECT_ID}`);

  try {
    // Get access token from metadata server (available in Cloud Build)
    let accessToken;
    try {
      console.log('Fetching access token from metadata server...');
      accessToken = execSync(
        'curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" | grep -o \'"access_token":"[^"]*\' | cut -d\'"\' -f4',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
      ).trim();
      console.log('Access token retrieved successfully');
    } catch (error) {
      console.log(`Could not get access token from metadata server: ${error.message}`);
      console.log('(This is expected when running locally, not in GCP)');
      return null;
    }

    if (!accessToken) {
      console.log('Empty access token, cannot query Cloud Build API');
      return null;
    }

    // Query Cloud Build API for last successful build
    // Filter: status=SUCCESS, sorted by createTime desc
    console.log('Querying Cloud Build API for successful builds...');

    // Try regional endpoint first (Cloud Build v2 uses regions)
    const REGION = process.env.REGION || 'europe-west1';
    let filter = encodeURIComponent(`status="SUCCESS"`);
    let apiUrl = `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/builds?filter=${filter}&pageSize=10`;

    console.log(`API URL: ${apiUrl}`);

    let response = execSync(`curl -s -H "Authorization: Bearer ${accessToken}" "${apiUrl}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });

    let data;
    try {
      data = JSON.parse(response);
    } catch (parseError) {
      console.log('Failed to parse Cloud Build API response');
      console.log('Response preview:', response.substring(0, 500));
      return null;
    }

    // Check for API errors
    if (data.error) {
      console.log('Cloud Build API returned error:');
      console.log(`  Code: ${data.error.code}`);
      console.log(`  Message: ${data.error.message}`);
      console.log(`  Status: ${data.error.status}`);
      if (data.error.code === 403) {
        console.log(
          '\n⚠️  Permission denied. The Cloud Build service account needs cloudbuild.builds.viewer role.'
        );
        console.log('   Run: cd terraform/environments/dev && terraform apply');
      }
      return null;
    }

    if (!data.builds || data.builds.length === 0) {
      console.log('No successful builds found in Cloud Build API');
      console.log('This is expected for the first build after setup');
      console.log('Raw API response:', JSON.stringify(data, null, 2).substring(0, 500));
      return null;
    }

    console.log(`Found ${data.builds.length} successful builds in API response`);

    // Find the most recent successful build on our branch (excluding current build)
    const currentCommit = process.env.COMMIT_SHA;
    console.log(
      `Current commit: ${currentCommit}, looking for previous builds on branch: ${BRANCH_NAME}`
    );

    for (const build of data.builds) {
      const buildCommit = build.substitutions?.COMMIT_SHA;
      const buildBranch = build.substitutions?.BRANCH_NAME;
      const buildId = build.id;

      console.log(`  Checking build ${buildId}: commit=${buildCommit}, branch=${buildBranch}`);

      // Skip current build and builds from other branches
      if (buildCommit === currentCommit) {
        console.log('    → Skipping (current build)');
        continue;
      }
      if (buildBranch && buildBranch !== BRANCH_NAME) {
        console.log(`    → Skipping (different branch: ${buildBranch})`);
        continue;
      }

      if (buildCommit && buildCommit.length === 40) {
        console.log(`✓ Found last successful build commit: ${buildCommit} (build ${buildId})`);
        return buildCommit;
      }
    }

    console.log('No matching successful build found for this branch');
    return null;
  } catch (error) {
    console.log(`Error querying Cloud Build API: ${error.message}`);
    if (error.stderr) {
      console.log('stderr:', error.stderr.toString().substring(0, 500));
    }
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
          execSync(
            `git fetch --unshallow origin ${BRANCH_NAME} || git fetch --depth=500 origin ${BRANCH_NAME}`,
            { stdio: 'pipe' }
          );
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
