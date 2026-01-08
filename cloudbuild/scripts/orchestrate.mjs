/**
 * cloudbuild/scripts/orchestrate.mjs
 * * 1. Detects affected services via git diff.
 * 2. Generates a parallel cloudbuild.json pipeline.
 * 3. Handles force deploys.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const PROJECT_ID = process.env.PROJECT_ID;
const REGION = process.env._REGION || 'europe-central2';
const ARTIFACT_URL = process.env._ARTIFACT_REGISTRY_URL;
const ENV_NAME = process.env._ENVIRONMENT || 'dev';
const BRANCH_NAME = process.env.BRANCH_NAME;
const FORCE_DEPLOY = process.env._FORCE_DEPLOY === 'true';

// === CONFIGURATION ===
const SERVICES = [
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
  'notes-agent',
  'todos-agent',
  'bookmarks-agent',
  'app-settings-service',
];

// Special handling paths
const PATHS = {
  web: ['apps/web/', 'packages/'],
  firestore: ['firestore/', 'firebase.json'],
};

// === 1. GIT DIFF LOGIC ===
function getDiff() {
  if (FORCE_DEPLOY) return null; // Null means "Build Everything"

  try {
    // Fetch specifically for CI context where history might be shallow
    execSync(`git fetch --depth=100 origin ${BRANCH_NAME} 2>/dev/null || true`);

    // Simple logic: changes since the previous commit on this branch
    // For more robustness, you can query the Cloud Build API here (omitted for speed)
    const diff = execSync(`git diff --name-only HEAD~1 HEAD`, { encoding: 'utf-8' });
    return diff.split('\n').filter(Boolean);
  } catch (e) {
    console.log('⚠ Git error or no history, defaulting to full rebuild.');
    return null;
  }
}

// === 2. DETERMINE AFFECTED ===
function getAffected() {
  const changedFiles = getDiff();
  if (!changedFiles) return [...SERVICES, 'web', 'firestore']; // All affected

  const affected = new Set();
  const isAffected = (files, prefixes) => files.some((f) => prefixes.some((p) => f.startsWith(p)));

  // Check Web & Firestore
  if (isAffected(changedFiles, PATHS.web)) affected.add('web');
  if (isAffected(changedFiles, PATHS.firestore)) affected.add('firestore');

  // Check Services (assumes apps/<name> structure)
  SERVICES.forEach((svc) => {
    // Check app folder AND shared packages if applicable
    const watch = [`apps/${svc}/`];
    // If you have shared deps, add logic here: e.g. if 'packages/ui' changed -> add all
    if (isAffected(changedFiles, watch)) affected.add(svc);
  });

  return Array.from(affected);
}

// === 3. GENERATE PIPELINE JSON ===
const affected = getAffected();
console.log(`>> Affected Services: ${affected.length > 0 ? affected.join(', ') : 'None'}`);

if (affected.length === 0) {
  process.exit(0); // Exit gracefully, nothing to do
}

const steps = [];

// Helper: Docker Build Step
const dockerStep = (svc) => [
  {
    name: 'gcr.io/cloud-builders/docker',
    id: `build-${svc}`,
    waitFor: ['-'], // Parallel start
    entrypoint: 'bash',
    args: [
      '-c',
      `
      docker pull ${ARTIFACT_URL}/${svc}:latest || true
      docker build \
        --cache-from=${ARTIFACT_URL}/${svc}:latest \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        -t ${ARTIFACT_URL}/${svc}:$COMMIT_SHA \
        -t ${ARTIFACT_URL}/${svc}:latest \
        -f apps/${svc}/Dockerfile .
      docker push ${ARTIFACT_URL}/${svc}:$COMMIT_SHA
      docker push ${ARTIFACT_URL}/${svc}:latest
    `,
    ],
    env: ['DOCKER_BUILDKIT=1'],
  },
  {
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
    id: `deploy-${svc}`,
    waitFor: [`build-${svc}`],
    entrypoint: 'bash',
    args: ['-c', `bash cloudbuild/scripts/deploy-${svc}.sh`],
    env: [
      'COMMIT_SHA=$COMMIT_SHA',
      `REGION=${REGION}`,
      `ARTIFACT_REGISTRY_URL=${ARTIFACT_URL}`,
      `ENVIRONMENT=${ENV_NAME}`,
    ],
  },
];

affected.forEach((svc) => {
  if (svc === 'web') {
    // Web logic (condensed)
    steps.push({
      name: 'node:22-slim',
      id: 'build-web',
      waitFor: ['-'],
      entrypoint: 'bash',
      // Note: We install deps ONLY for web, and only if affected
      args: ['-c', 'npm ci && npm run --workspace=@intexuraos/web build'],
    });
    steps.push({
      name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
      id: 'deploy-web',
      waitFor: ['build-web'],
      entrypoint: 'bash',
      args: ['-c', 'bash cloudbuild/scripts/deploy-web.sh'],
      env: [`ENVIRONMENT=${ENV_NAME}`, `REGION=${REGION}`, `ARTIFACT_REGISTRY_URL=${ARTIFACT_URL}`],
    });
  } else if (svc === 'firestore') {
    steps.push({
      name: 'node:22-slim',
      id: 'deploy-firestore',
      waitFor: ['-'],
      entrypoint: 'bash',
      args: ['-c', 'bash cloudbuild/scripts/deploy-firestore.sh'],
      env: [`PROJECT_ID=${PROJECT_ID}`],
    });
  } else {
    steps.push(...dockerStep(svc));
  }
});

const pipeline = {
  steps,
  options: {
    logging: 'CLOUD_LOGGING_ONLY',
    machineType: 'E2_HIGHCPU_8',
    env: ['DOCKER_BUILDKIT=1'],
  },
  timeout: '1800s',
};

writeFileSync('cloudbuild.dynamic.json', JSON.stringify(pipeline, null, 2));
console.log('>> cloudbuild.dynamic.json generated');
