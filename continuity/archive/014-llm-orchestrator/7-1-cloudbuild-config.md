# Task 7-1: Create Cloud Build Configuration

**Tier:** 7 (Depends on 7-0)

---

## Context Snapshot

- Terraform module created (7-0)
- Need Cloud Build for CI/CD
- Following patterns from existing services

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create Cloud Build configuration for:

1. Building Docker image
2. Pushing to Container Registry
3. Deploying to Cloud Run

---

## Scope

**In scope:**

- Deploy script
- Cloud Build steps for llm-orchestrator-service
- Dockerfile verification

**Non-scope:**

- Terraform module (task 7-0)

---

## Required Approach

### Step 1: Create deploy script

`cloudbuild/scripts/deploy-llm-orchestrator-service.sh`:

```bash
#!/bin/bash
set -e

SERVICE_NAME="llm-orchestrator-service"
REGION="${REGION:-us-central1}"

echo "Building ${SERVICE_NAME}..."
docker build \
  -f apps/llm-orchestrator-service/Dockerfile \
  -t "gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${COMMIT_SHA}" \
  -t "gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest" \
  .

echo "Pushing ${SERVICE_NAME}..."
docker push "gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${COMMIT_SHA}"
docker push "gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"

echo "Deploying ${SERVICE_NAME}..."
gcloud run deploy ${SERVICE_NAME} \
  --image "gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${COMMIT_SHA}" \
  --region ${REGION} \
  --platform managed \
  --quiet

echo "${SERVICE_NAME} deployed successfully!"
```

### Step 2: Verify/Create Dockerfile

`apps/llm-orchestrator-service/Dockerfile`:

```dockerfile
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace files
COPY package*.json ./
COPY packages/common-core/package*.json packages/common-core/
COPY packages/http-server/package*.json packages/http-server/
COPY packages/infra-firestore/package*.json packages/infra-firestore/
COPY packages/infra-gemini/package*.json packages/infra-gemini/
COPY packages/infra-claude/package*.json packages/infra-claude/
COPY packages/infra-gpt/package*.json packages/infra-gpt/
COPY packages/infra-whatsapp/package*.json packages/infra-whatsapp/
COPY apps/llm-orchestrator-service/package*.json apps/llm-orchestrator-service/

RUN npm ci --workspace=@intexuraos/llm-orchestrator-service

# Copy source
COPY tsconfig*.json ./
COPY packages/ packages/
COPY apps/llm-orchestrator-service/ apps/llm-orchestrator-service/

# Build
RUN npm run build --workspace=@intexuraos/llm-orchestrator-service

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/common-core/dist packages/common-core/dist
COPY --from=builder /app/packages/common-core/package.json packages/common-core/
COPY --from=builder /app/packages/http-server/dist packages/http-server/dist
COPY --from=builder /app/packages/http-server/package.json packages/http-server/
COPY --from=builder /app/packages/infra-firestore/dist packages/infra-firestore/dist
COPY --from=builder /app/packages/infra-firestore/package.json packages/infra-firestore/
COPY --from=builder /app/packages/infra-gemini/dist packages/infra-gemini/dist
COPY --from=builder /app/packages/infra-gemini/package.json packages/infra-gemini/
COPY --from=builder /app/packages/infra-claude/dist packages/infra-claude/dist
COPY --from=builder /app/packages/infra-claude/package.json packages/infra-claude/
COPY --from=builder /app/packages/infra-gpt/dist packages/infra-gpt/dist
COPY --from=builder /app/packages/infra-gpt/package.json packages/infra-gpt/
COPY --from=builder /app/packages/infra-whatsapp/dist packages/infra-whatsapp/dist
COPY --from=builder /app/packages/infra-whatsapp/package.json packages/infra-whatsapp/
COPY --from=builder /app/apps/llm-orchestrator-service/dist apps/llm-orchestrator-service/dist
COPY --from=builder /app/apps/llm-orchestrator-service/package.json apps/llm-orchestrator-service/

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "apps/llm-orchestrator-service/dist/index.js"]
```

### Step 3: Update cloudbuild.yaml

Add build step to `cloudbuild/cloudbuild.yaml`:

```yaml
# Add to steps
- id: 'deploy-llm-orchestrator-service'
  name: 'gcr.io/cloud-builders/docker'
  dir: '.'
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      ./cloudbuild/scripts/deploy-llm-orchestrator-service.sh
  env:
    - 'PROJECT_ID=${PROJECT_ID}'
    - 'COMMIT_SHA=${COMMIT_SHA}'
    - 'REGION=us-central1'
  waitFor: ['build-packages']
```

---

## Step Checklist

- [ ] Create deploy script
- [ ] Make script executable
- [ ] Create/verify Dockerfile
- [ ] Update cloudbuild.yaml
- [ ] Run verification commands

---

## Definition of Done

1. Deploy script created
2. Dockerfile created/verified
3. Cloud Build steps added
4. All files properly formatted

---

## Verification Commands

```bash
chmod +x cloudbuild/scripts/deploy-llm-orchestrator-service.sh
docker build -f apps/llm-orchestrator-service/Dockerfile -t test-build .
```

---

## Rollback Plan

If verification fails:

1. Remove deploy script
2. Revert Dockerfile changes
3. Revert cloudbuild.yaml changes

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
