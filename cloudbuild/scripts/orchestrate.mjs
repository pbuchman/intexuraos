import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// === CONFIGURATION ===
const PROJECT_ID = process.env.PROJECT_ID;
const REGION = process.env._REGION || 'europe-central2';
const ARTIFACT_URL = process.env._ARTIFACT_REGISTRY_URL;
const ENV_NAME = process.env._ENVIRONMENT || 'dev';
const BRANCH_NAME = process.env.BRANCH_NAME || 'development';
const CURRENT_COMMIT = process.env.COMMIT_SHA;

// Services list
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

// Specific paths for non-standard services
const SPECIAL_PATHS = {
  web: ['apps/web/', 'packages/'],
  firestore: ['firestore/', 'firebase.json'],
};

// === ⚡ GLOBAL TRIGGERS ⚡ ===
// If any of these change, we rebuild EVERYTHING.
const GLOBAL_TRIGGERS = [
  'cloudbuild/', // Build scripts themselves
  'package.json', // Root dependencies
  'package-lock.json',
  'tsconfig.base.json', // Shared configs
  'terraform/', // Infrastructure changes (optional, based on your preference)
  'scripts/', // Global utility scripts
];

// === 1. API HELPER (Fetch Last Successful Commit) ===
async function getLastSuccessfulCommit() {
  if (process.env._FORCE_DEPLOY === 'true') {
    console.log('>> Force deploy enabled. Rebuilding all.');
    return null;
  }

  try {
    const tokenCmd = `curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" | grep -o '"access_token":"[^"]*'`;
    const tokenJson = execSync(tokenCmd, { encoding: 'utf-8' });
    const token = tokenJson.split(':')[1].replace(/"/g, '').trim();

    console.log(`>> Querying Cloud Build API for last success on branch: ${BRANCH_NAME}...`);
    const filter = `status="SUCCESS" AND substitutions.BRANCH_NAME="${BRANCH_NAME}"`;
    const url = `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/builds?pageSize=5&filter=${encodeURIComponent(filter)}`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();

    if (!data.builds || data.builds.length === 0) {
      console.log('>> No previous successful builds found.');
      return null;
    }

    for (const build of data.builds) {
      const sha = build.substitutions?.COMMIT_SHA;
      if (sha && sha !== CURRENT_COMMIT) {
        console.log(`>> Found baseline commit: ${sha}`);
        return sha;
      }
    }
  } catch (e) {
    console.warn(
      `>> Warning: Failed to fetch build history (${e.message}). Defaulting to full rebuild.`
    );
  }
  return null;
}

// === 2. GIT DIFF LOGIC ===
async function getAffectedServices() {
  const lastSuccessSha = await getLastSuccessfulCommit();

  if (!lastSuccessSha) return [...SERVICES, 'web', 'firestore'];

  try {
    console.log(`>> Calculating diff between ${lastSuccessSha}..${CURRENT_COMMIT}`);
    // Fetch enough history to find the common ancestor
    execSync(`git fetch --depth=500 origin ${BRANCH_NAME} 2>/dev/null || true`);

    const diff = execSync(`git diff --name-only ${lastSuccessSha} ${CURRENT_COMMIT}`, {
      encoding: 'utf-8',
    });
    const changedFiles = diff.split('\n').filter(Boolean);

    if (changedFiles.length === 0) return [];

    // Helper to check matches
    const check = (files, prefixes) => files.some((f) => prefixes.some((p) => f.startsWith(p)));

    // 🚨 GLOBAL TRIGGER CHECK 🚨
    if (check(changedFiles, GLOBAL_TRIGGERS)) {
      console.log(
        '>> ⚠️  Global configuration or shared dependency changed. Rebuilding ALL services.'
      );
      return [...SERVICES, 'web', 'firestore'];
    }

    const affected = new Set();

    // Check special targets
    if (check(changedFiles, SPECIAL_PATHS.web)) affected.add('web');
    if (check(changedFiles, SPECIAL_PATHS.firestore)) affected.add('firestore');

    // Check standard services
    SERVICES.forEach((svc) => {
      // Logic: If 'apps/svc' changes OR a shared package it depends on changes
      const watch = [`apps/${svc}/`, 'packages/'];
      if (check(changedFiles, watch)) affected.add(svc);
    });

    return Array.from(affected);
  } catch (e) {
    console.log(`>> Git diff failed (${e.message}). Rebuilding all.`);
    return [...SERVICES, 'web', 'firestore'];
  }
}

// === 3. GENERATE PIPELINE ===
(async () => {
  const affected = await getAffectedServices();
  console.log(`>> Affected Services: ${affected.length > 0 ? affected.join(', ') : 'None'}`);

  if (affected.length === 0) return;

  const steps = [];

  const addServiceSteps = (svc) => {
    steps.push({
      name: 'gcr.io/cloud-builders/docker',
      id: `build-${svc}`,
      waitFor: ['-'],
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
    });
    steps.push({
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
    });
  };

  affected.forEach((svc) => {
    if (svc === 'web') {
      steps.push({
        name: 'node:22-slim',
        id: 'build-web',
        waitFor: ['-'],
        args: ['-c', 'npm ci && npm run --workspace=@intexuraos/web build'],
      });
      steps.push({
        name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
        id: 'deploy-web',
        waitFor: ['build-web'],
        entrypoint: 'bash',
        args: ['-c', 'bash cloudbuild/scripts/deploy-web.sh'],
        env: [
          `ENVIRONMENT=${ENV_NAME}`,
          `REGION=${REGION}`,
          `ARTIFACT_REGISTRY_URL=${ARTIFACT_URL}`,
        ],
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
      addServiceSteps(svc);
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
})();
