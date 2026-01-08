/**
 * Dynamic Cloud Build Pipeline Generator
 *
 * Reads affected services from /workspace/.affected/ and generates
 * a tailored cloudbuild.dynamic.json with only the necessary steps.
 *
 * This eliminates container initialization overhead for unaffected services.
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';
const AFFECTED_DIR = join(WORKSPACE, '.affected');
const ARTIFACT_URL = process.env._ARTIFACT_REGISTRY_URL;
const REGION = process.env._REGION;
const ENV_NAME = process.env._ENVIRONMENT;
const PROJECT_ID = process.env.PROJECT_ID;

// Services that have special build/deploy logic
const SPECIAL_TARGETS = ['web', 'firestore'];

// All Docker-based services (order doesn't matter - they run in parallel)
const DOCKER_SERVICES = [
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

// Web secrets that need to be fetched from Secret Manager
const WEB_SECRETS = [
  'INTEXURAOS_AUTH0_DOMAIN',
  'INTEXURAOS_AUTH0_SPA_CLIENT_ID',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_PROMPTVAULT_SERVICE_URL',
  'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'INTEXURAOS_NOTION_SERVICE_URL',
  'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
  'INTEXURAOS_LLM_ORCHESTRATOR_URL',
  'INTEXURAOS_COMMANDS_ROUTER_SERVICE_URL',
  'INTEXURAOS_ACTIONS_AGENT_SERVICE_URL',
  'INTEXURAOS_DATA_INSIGHTS_SERVICE_URL',
  'INTEXURAOS_NOTES_AGENT_URL',
  'INTEXURAOS_TODOS_AGENT_URL',
  'INTEXURAOS_BOOKMARKS_AGENT_URL',
  'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
  'INTEXURAOS_FIREBASE_PROJECT_ID',
  'INTEXURAOS_FIREBASE_API_KEY',
  'INTEXURAOS_FIREBASE_AUTH_DOMAIN',
];

// 1. Read affected services
let affectedServices = [];
try {
  affectedServices = readdirSync(AFFECTED_DIR).filter((f) => !f.startsWith('.'));
} catch {
  console.log('No .affected directory found. Nothing to deploy.');
  process.exit(0);
}

if (affectedServices.length === 0) {
  console.log('No services listed in .affected. Exiting.');
  process.exit(0);
}

console.log(`Generating pipeline for: ${affectedServices.join(', ')}`);

// 2. Step Templates

/**
 * Standard Docker Service Build Step
 * Runs immediately (waitFor: ['-']) for maximum parallelism
 */
function createBuildStep(service) {
  return {
    name: 'gcr.io/cloud-builders/docker',
    id: `build-${service}`,
    waitFor: ['-'],
    entrypoint: 'bash',
    args: [
      '-c',
      `
echo "=== Building ${service} ==="
docker pull \${_ARTIFACT_REGISTRY_URL}/${service}:latest || true
docker build \\
  --cache-from=\${_ARTIFACT_REGISTRY_URL}/${service}:latest \\
  --build-arg BUILDKIT_INLINE_CACHE=1 \\
  -t \${_ARTIFACT_REGISTRY_URL}/${service}:\$COMMIT_SHA \\
  -t \${_ARTIFACT_REGISTRY_URL}/${service}:latest \\
  -f apps/${service}/Dockerfile .
docker push \${_ARTIFACT_REGISTRY_URL}/${service}:\$COMMIT_SHA
docker push \${_ARTIFACT_REGISTRY_URL}/${service}:latest
      `.trim(),
    ],
    env: ['DOCKER_BUILDKIT=1'],
  };
}

/**
 * Standard Docker Service Deploy Step
 * Waits for its corresponding build step
 */
function createDeployStep(service) {
  return {
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
    id: `deploy-${service}`,
    waitFor: [`build-${service}`],
    entrypoint: 'bash',
    args: ['-c', `bash cloudbuild/scripts/deploy-${service}.sh`],
    env: [
      'COMMIT_SHA=$COMMIT_SHA',
      `REGION=\${_REGION}`,
      `ARTIFACT_REGISTRY_URL=\${_ARTIFACT_REGISTRY_URL}`,
      `ENVIRONMENT=\${_ENVIRONMENT}`,
    ],
  };
}

/**
 * Create web pipeline steps (fetch secrets -> npm ci -> build -> deploy)
 */
function createWebSteps() {
  const secretLines = WEB_SECRETS.map(
    (secret) => `${secret}=$(gcloud secrets versions access latest --secret=${secret})`
  ).join('\n');

  return [
    // npm ci for web build
    {
      name: 'node:22-slim',
      id: 'npm-ci',
      waitFor: ['-'],
      entrypoint: 'npm',
      args: ['ci'],
    },
    // Fetch secrets
    {
      name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
      id: 'fetch-web-secrets',
      waitFor: ['-'],
      entrypoint: 'bash',
      args: [
        '-c',
        `
echo "=== Fetching secrets for web ==="
cat > /workspace/apps/web/.env << 'EOF'
${secretLines}
EOF
echo "Secrets written to /workspace/apps/web/.env"
        `.trim(),
      ],
    },
    // Build web
    {
      name: 'node:22-slim',
      id: 'build-web',
      waitFor: ['npm-ci', 'fetch-web-secrets'],
      entrypoint: 'bash',
      args: [
        '-c',
        `
echo "=== Building web ==="
npm run --workspace=@intexuraos/web build
        `.trim(),
      ],
      env: ['COMMIT_SHA=$COMMIT_SHA'],
    },
    // Deploy web
    {
      name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
      id: 'deploy-web',
      waitFor: ['build-web'],
      entrypoint: 'bash',
      args: ['-c', 'bash cloudbuild/scripts/deploy-web.sh'],
      env: [
        'ENVIRONMENT=${_ENVIRONMENT}',
        'COMMIT_SHA=$COMMIT_SHA',
        'REGION=${_REGION}',
        'ARTIFACT_REGISTRY_URL=${_ARTIFACT_REGISTRY_URL}',
      ],
    },
  ];
}

/**
 * Create firestore deploy step
 */
function createFirestoreStep() {
  return {
    name: 'node:22-slim',
    id: 'deploy-firestore',
    waitFor: ['-'],
    entrypoint: 'bash',
    args: ['-c', 'bash cloudbuild/scripts/deploy-firestore.sh'],
    env: ['PROJECT_ID=$PROJECT_ID'],
  };
}

// 3. Construct Pipeline Steps
const steps = [];
let needsNpmCi = false;

for (const svc of affectedServices) {
  if (svc === 'web') {
    // Web has its own npm-ci step built in
    steps.push(...createWebSteps());
  } else if (svc === 'firestore') {
    steps.push(createFirestoreStep());
  } else if (DOCKER_SERVICES.includes(svc)) {
    steps.push(createBuildStep(svc));
    steps.push(createDeployStep(svc));
  } else {
    console.warn(`Unknown service: ${svc}, skipping.`);
  }
}

if (steps.length === 0) {
  console.log('No valid services to deploy. Exiting.');
  process.exit(0);
}

// 4. Create Final Config Object
const cloudBuildConfig = {
  steps,
  options: {
    logging: 'CLOUD_LOGGING_ONLY',
    machineType: 'E2_HIGHCPU_8',
    env: ['DOCKER_BUILDKIT=1'],
  },
  timeout: '1800s',
};

// 5. Write to disk
const outputPath = join(WORKSPACE, 'cloudbuild.dynamic.json');
writeFileSync(outputPath, JSON.stringify(cloudBuildConfig, null, 2));
console.log(`Pipeline config written to ${outputPath}`);
console.log(`Total steps: ${steps.length}`);
