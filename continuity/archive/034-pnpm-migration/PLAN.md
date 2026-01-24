# pnpm Migration Plan

**Status:** Planning Phase
**Created:** 2025-01-12
**Goal:** Migrate IntexuraOS monorepo from npm to pnpm

---

## Executive Summary

IntexuraOS is a **36-workspace monorepo** (18 apps, 18 packages) currently using npm with `package-lock.json`. This plan details migration to pnpm for:

- Faster install times
- Efficient disk usage via content-addressable storage
- Strict dependency management
- Better monorepo support

**Requirement:** After migration, NO "npm" references remain in code (unless explicitly approved).

`★ Insight ─────────────────────────────────────`

- **pnpm workspace protocol**: pnpm uses `"workspace:*"` for local dependencies, unlike npm's automatic hoisting. This requires updating `package.json` files to declare internal dependencies explicitly
- **Strict node_modules**: pnpm creates a symlink-based structure where packages only have access to their declared dependencies. This prevents phantom dependencies but may reveal undeclared deps
- **Lockfile conversion**: `pnpm import` converts `package-lock.json` to `pnpm-lock.yaml`, but manual verification is recommended for edge cases
  `─────────────────────────────────────────────────`

---

## Current State Analysis

### Repository Structure

| Type                    | Count | Locations                                                                             |
| ----------------------- | ----- | ------------------------------------------------------------------------------------- |
| **Apps**                | 18    | `apps/*/package.json`                                                                 |
| **Packages**            | 18    | `packages/*/package.json`                                                             |
| **Dockerfiles**         | 18    | `apps/*/Dockerfile` + `tools/pubsub-ui/Dockerfile`                                    |
| **CI Workflows**        | 4     | `.github/workflows/{ci,coverage-analysis,coverage-pr-report,copilot-setup-steps}.yml` |
| **Cloud Build configs** | 3     | `cloudbuild/*.yaml`, `apps/web/cloudbuild.yaml`                                       |

### Current npm References Found

| Location                             | References            | Action Required                  |
| ------------------------------------ | --------------------- | -------------------------------- |
| `package.json` scripts               | 3 occurrences         | Replace with `pnpm`              |
| `package.json` workspaces            | 1 array               | Migrate to `pnpm-workspace.yaml` |
| `package-lock.json`                  | 1 file                | Replace with `pnpm-lock.yaml`    |
| CI workflows (4 files)               | `npm ci`, `npm run`   | Replace with `pnpm`              |
| Dockerfiles (18 files)               | `npm ci`, `npm run`   | Replace with `pnpm`              |
| Cloud Build configs (3 files)        | `npm ci`, `npm run`   | Replace with `pnpm`              |
| Documentation (CLAUDE.md, README.md) | `npm run ci` examples | Replace with `pnpm`              |

### Scripts Requiring Updates

| Script                    | Current                          | Target                                                          |
| ------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `typecheck:sequential`    | `npm run typecheck --workspaces` | `pnpm -r --filter './apps/*' --filter './packages/*' typecheck` |
| `build`                   | `npm run build --workspaces`     | `pnpm -r build`                                                 |
| `verify:llm-architecture` | `npx tsx ...`                    | `pnpm tsx ...`                                                  |

---

## Phase 1: Root Configuration

### 1.1 Create `pnpm-workspace.yaml`

**NEW FILE:** `/pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### 1.2 Update Root `package.json`

**Remove:**

```json
"workspaces": ["apps/*", "packages/*"]
```

**Update engines:**

```json
"engines": {
  "node": ">=22.0.0",
  "pnpm": ">=9.0.0"
}
```

**Update scripts:**

| Script                    | Before                                        | After                                         |
| ------------------------- | --------------------------------------------- | --------------------------------------------- |
| `typecheck:sequential`    | `npm run typecheck --workspaces --if-present` | `pnpm -r --if-present typecheck`              |
| `build`                   | `npm run build --workspaces --if-present`     | `pnpm -r --if-present build`                  |
| `verify:llm-architecture` | `npx tsx scripts/verify-llm-architecture.ts`  | `pnpm tsx scripts/verify-llm-architecture.ts` |

### 1.3 Update `.npmrc`

**ADD to existing `.npmrc`:**

```ini
# pnpm configuration
shamefully-hoist=false
strict-peer-dependencies=false
```

### 1.4 Generate pnpm Lockfile

```bash
# Delete npm lockfile
rm package-lock.json

# Generate pnpm lockfile
pnpm install
```

---

## Phase 2: Dockerfiles (18 files)

### 2.1 Service Dockerfile Template

All 18 service Dockerfiles follow this pattern. Update each identically:

**Before:**

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy all package.json files
COPY package*.json ./
COPY apps/<service>/package*.json ./apps/<service>/
COPY packages/*/package*.json ./packages/

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/<service>/ ./apps/<service>/

# Build service
RUN npm run build -w @intexuraos/<service>

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

# Copy generated production package.json and install deps
COPY --from=builder /app/apps/<service>/dist/package.json ./
RUN npm install --omit=dev

# Copy built file
COPY --from=builder /app/apps/<service>/dist/index.js ./dist/
COPY --from=builder /app/apps/<service>/dist/index.js.map ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
```

**After:**

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package*.json ./
COPY apps/<service>/package*.json ./apps/<service>/
COPY packages/*/package*.json ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/<service>/ ./apps/<service>/

# Build service
RUN pnpm run --filter @intexuraos/<service> build

# Stage 2: Production
FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy generated production package.json and install deps
COPY --from=builder /app/apps/<service>/dist/package.json ./
RUN pnpm install --prod --frozen-lockfile

# Copy built file
COPY --from=builder /app/apps/<service>/dist/index.js ./dist/
COPY --from=builder /app/apps/<service>/dist/index.js.map ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
```

### 2.2 Dockerfiles to Update

| Service                      | Path                                           |
| ---------------------------- | ---------------------------------------------- |
| actions-agent                | `apps/actions-agent/Dockerfile`                |
| api-docs-hub                 | `apps/api-docs-hub/Dockerfile`                 |
| app-settings-service         | `apps/app-settings-service/Dockerfile`         |
| bookmarks-agent              | `apps/bookmarks-agent/Dockerfile`              |
| calendar-agent               | `apps/calendar-agent/Dockerfile`               |
| commands-agent               | `apps/commands-agent/Dockerfile`               |
| data-insights-agent          | `apps/data-insights-agent/Dockerfile`          |
| image-service                | `apps/image-service/Dockerfile`                |
| mobile-notifications-service | `apps/mobile-notifications-service/Dockerfile` |
| notes-agent                  | `apps/notes-agent/Dockerfile`                  |
| notion-service               | `apps/notion-service/Dockerfile`               |
| promptvault-service          | `apps/promptvault-service/Dockerfile`          |
| research-agent               | `apps/research-agent/Dockerfile`               |
| todos-agent                  | `apps/todos-agent/Dockerfile`                  |
| user-service                 | `apps/user-service/Dockerfile`                 |
| web-agent                    | `apps/web-agent/Dockerfile`                    |
| whatsapp-service             | `apps/whatsapp-service/Dockerfile`             |
| pubsub-ui                    | `tools/pubsub-ui/Dockerfile`                   |

---

## Phase 3: GitHub Actions CI/CD

### 3.1 Main CI Workflow (`.github/workflows/ci.yml`)

**Before:**

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'npm'

- name: Install dependencies
  run: npm ci

- name: Run CI
  run: npm run ci
```

**After:**

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 9

- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'pnpm'

- name: Install dependencies
  run: pnpm install

- name: Run CI
  run: pnpm run ci
```

### 3.2 Coverage Workflow (`.github/workflows/coverage-analysis.yml`)

**Replace all:**
| Before | After |
|--------|-------|
| `cache: 'npm'` | `cache: 'pnpm'` |
| `npm ci` | `pnpm install` |
| `npm run build` | `pnpm run build` |
| `npm run test:coverage` | `pnpm run test:coverage` |
| `npx prettier --write .` | `pnpm prettier --write .` |
| `npm run ci` | `pnpm run ci` |

### 3.3 Coverage PR Report (`.github/workflows/coverage-pr-report.yml`)

**Replace all:**
| Before | After |
|--------|-------|
| `cache: 'npm'` | `cache: 'pnpm'` |
| `npm ci` | `pnpm install` |
| `npm run build` | `pnpm run build` |
| `npm run test:coverage` | `pnpm run test:coverage` |

### 3.4 Copilot Setup (`.github/workflows/copilot-setup-steps.yml`)

Review and update any npm references to pnpm.

---

## Phase 4: Cloud Build Configuration

### 4.1 Main Build Pipeline (`cloudbuild/cloudbuild.yaml`)

**Dependency Installation Step:**

**Before:**

```yaml
- name: 'node:22-slim'
  id: 'npm-ci'
  entrypoint: 'npm'
  args: ['ci']
```

**After:**

```yaml
- name: 'node:22-slim'
  id: 'pnpm-install'
  entrypoint: 'sh'
  args:
    - '-c'
    - |
      npm install -g pnpm@9
      pnpm install --frozen-lockfile
```

**Web Build Step:**

**Before:**

```yaml
- name: 'node:22-slim'
  id: 'build-web'
  waitFor: ['npm-ci', 'fetch-web-config']
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      echo "=== Building web ==="
      npm run --workspace=@intexuraos/web build
```

**After:**

```yaml
- name: 'node:22-slim'
  id: 'build-web'
  waitFor: ['pnpm-install', 'fetch-web-config']
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      echo "=== Building web ==="
      pnpm run --filter @intexuraos/web build
```

**Firestore Deploy Step:**

**Before:**

```yaml
- name: 'node:22-slim'
  id: 'deploy-firestore'
  waitFor: ['npm-ci']
```

**After:**

```yaml
- name: 'node:22-slim'
  id: 'deploy-firestore'
  waitFor: ['pnpm-install']
```

### 4.2 Firestore Build (`cloudbuild/cloudbuild-firestore.yaml`)

**Before:**

```yaml
- name: 'node:22-slim'
  id: 'deploy'
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      rm -rf node_modules
      npm ci
      bash cloudbuild/scripts/deploy-firestore.sh
```

**After:**

```yaml
- name: 'node:22-slim'
  id: 'deploy'
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      npm install -g pnpm@9
      rm -rf node_modules
      pnpm install --frozen-lockfile
      bash cloudbuild/scripts/deploy-firestore.sh
```

### 4.3 Web Build (`apps/web/cloudbuild.yaml`)

**Before:**

```yaml
- name: 'node:22-slim'
  id: 'build'
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      apt-get update && apt-get install -y git
      npm ci
      npm run --workspace=@intexuraos/web build
```

**After:**

```yaml
- name: 'node:22-slim'
  id: 'build'
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      apt-get update && apt-get install -y git
      npm install -g pnpm@9
      pnpm install --frozen-lockfile
      pnpm run --filter @intexuraos/web build
```

---

## Phase 5: Documentation Updates

### 5.1 CLAUDE.md

**Replace all instances:**

| Before                             | After                               |
| ---------------------------------- | ----------------------------------- |
| `npm run ci`                       | `pnpm run ci`                       |
| `npm run verify:workspace:tracked` | `pnpm run verify:workspace:tracked` |
| `npm run ci:tracked`               | `pnpm run ci:tracked`               |
| `npm run ci:report`                | `pnpm run ci:report`                |
| `npm run verify:firestore`         | `pnpm run verify:firestore`         |
| `npm run verify:pubsub`            | `pnpm run verify:pubsub`            |
| `npm run test`                     | `pnpm run test`                     |
| `npm run typecheck:tests`          | `pnpm run typecheck:tests`          |

### 5.2 README.md

**Replace all npm command examples with pnpm equivalents.**

### 5.3 Other Documentation

Review and update:

- `docs/setup/*.md`
- `docs/architecture/*.md`
- `docs/patterns/*.md`
- `.claude/commands/*.md`

---

## Phase 6: Workspace Dependency Verification

### 6.1 Check for Phantom Dependencies

After `pnpm install`, run:

```bash
# Verify all workspaces install correctly
pnpm list --depth=0

# Check for any missing dependencies
pnpm run -r --if-present build
```

**Common issues to watch for:**

- Packages importing dependencies not in their `package.json`
- Workspace references needing `workspace:*` protocol

### 6.2 Update Internal Dependencies (if needed)

If any workspace has internal dependencies, they should use the `workspace:` protocol:

```json
{
  "dependencies": {
    "@intexuraos/common-core": "workspace:*",
    "@intexuraos/http-server": "workspace:*"
  }
}
```

---

## Phase 7: Verification & Testing

### 7.1 Pre-Commit Checklist

- [ ] `pnpm install` succeeds
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run lint` passes
- [ ] `pnpm run test:coverage` passes (95%+)
- [ ] `pnpm run build` succeeds for all workspaces
- [ ] `pnpm run ci` passes completely
- [ ] No "npm" in code (except approved exceptions)

### 7.2 Docker Build Verification

Test build a few services locally:

```bash
# Test one service build
docker build -f apps/user-service/Dockerfile -t test-user-service .

# Verify image can run
docker run --rm test-user-service node --version
```

### 7.3 CI Verification

Push to a feature branch and verify:

- [ ] GitHub Actions CI passes
- [ ] Coverage workflows pass
- [ ] No new issues introduced

---

## Phase 8: Deployment

### 8.1 Deployment Steps

1. **Create feature branch** from `main`
2. **Apply all changes** from Phases 1-7
3. **Run full local verification**
4. **Push to GitHub**
5. **Verify CI passes**
6. **Merge to `development`**
7. **Monitor Cloud Build deployment**
8. **Verify services in dev environment**

### 8.2 Rollback Plan

If deployment fails:

1. Revert merge commit
2. Force push reverted commit
3. Monitor Cloud Build
4. Investigate failure
5. Fix and retry

---

## Appendix A: Command Reference

### Common Commands

| Task                      | npm                          | pnpm                                   |
| ------------------------- | ---------------------------- | -------------------------------------- |
| Install                   | `npm ci`                     | `pnpm install`                         |
| Add dependency            | `npm install <pkg>`          | `pnpm add <pkg>`                       |
| Add dev dependency        | `npm install -D <pkg>`       | `pnpm add -D <pkg>`                    |
| Run script                | `npm run <script>`           | `pnpm run <script>` or `pnpm <script>` |
| Run in all workspaces     | `npm run <script> -ws`       | `pnpm -r <script>`                     |
| Run in specific workspace | `npm run <script> -w <name>` | `pnpm run --filter <name> <script>`    |
| Run npx package           | `npx <pkg>`                  | `pnpm <pkg>` or `pnpm dlx <pkg>`       |
| List dependencies         | `npm ls`                     | `pnpm ls`                              |
| Check outdated            | `npm outdated`               | `pnpm outdated`                        |
| Audit                     | `npm audit`                  | `pnpm audit`                           |

### pnpm Workspace Commands

| Task                              | Command                                |
| --------------------------------- | -------------------------------------- |
| List workspace packages           | `pnpm list -r --depth=0`               |
| Run script in all workspaces      | `pnpm -r <script>`                     |
| Run script in filtered workspaces | `pnpm -r --filter "./apps/*" <script>` |
| Why is package installed          | `pnpm why <package>`                   |

---

## Appendix B: File Change Summary

| File Type  | Count | Change Type                  |
| ---------- | ----- | ---------------------------- |
| **NEW**    | 1     | `pnpm-workspace.yaml`        |
| **DELETE** | 1     | `package-lock.json`          |
| **MODIFY** | 1     | `package.json` (root)        |
| **MODIFY** | 1     | `.npmrc`                     |
| **MODIFY** | 18    | `apps/*/Dockerfile`          |
| **MODIFY** | 1     | `tools/pubsub-ui/Dockerfile` |
| **MODIFY** | 4     | `.github/workflows/*.yml`    |
| **MODIFY** | 3     | `cloudbuild/*.yaml`          |
| **MODIFY** | 1     | `apps/web/cloudbuild.yaml`   |
| **MODIFY** | ~10   | Documentation files          |

**Total: ~42 files to modify/create/delete**

---

## Appendix C: Potential Issues & Solutions

### Issue 1: Phantom Dependencies

**Symptom:** `Cannot find module 'X'` after migration

**Cause:** npm allows accessing dependencies of dependencies; pnpm does not

**Solution:** Add missing dependency to the workspace's `package.json`:

```bash
pnpm add <missing-package> --filter @intexuraos/<workspace-name>
```

### Issue 2: Lockfile Conversion Errors

**Symptom:** `pnpm import` fails or produces invalid lockfile

**Solution:** Manual lockfile generation:

```bash
rm package-lock.json
pnpm install
```

### Issue 3: Docker Build Caching

**Symptom:** Old dependencies used in Docker builds

**Solution:** Ensure `pnpm-lock.yaml` is copied before `package.json` files in Dockerfile

### Issue 4: CI Cache Issues

**Symptom:** CI fails with cache errors after migration

**Solution:** Manually clear GitHub Actions cache:

- Settings → Actions → Caches → Delete `pnpm` cache

---

## Next Steps

1. **Review this plan** — Confirm approach and scope
2. **Create feature branch** — `npm-to-pnp` or similar
3. **Execute phases sequentially** — Start with Phase 1
4. **Test at each phase** — Verify before proceeding
5. **Full CI verification** — Must pass before merging

---

## Approval Required

Before proceeding, confirm:

- [ ] pnpm version 9.x is acceptable
- [ ] No exceptions to "no npm in code" rule
- [ ] Timeline expectations
- [ ] Any service-specific concerns

---

**END OF PLAN**
