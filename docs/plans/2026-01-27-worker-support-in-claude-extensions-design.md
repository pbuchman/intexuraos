# Worker Support in Claude Extensions

**Date:** 2026-01-27
**Status:** Approved

## Overview

Update Claude agents, commands, and skills to handle workers (`workers/`) alongside apps (`apps/`) and packages (`packages/`). Use unified "services" terminology to cover both apps and workers, with type distinction where needed.

## Decisions Made

| Decision               | Choice                                       |
| ---------------------- | -------------------------------------------- |
| Terminology            | Unified as "services" (apps + workers)       |
| Worker documentation   | Same 5-file treatment as apps                |
| Discovery output       | Separate lists for apps and workers          |
| Release Phase 2        | Document apps and workers in parallel        |
| Coverage threshold     | Same 95% for workers                         |
| Service-creator        | Single agent with branching logic            |
| Create-service default | Apps as default, `--worker` flag for workers |

## Files to Update (9 total)

### 1. `.claude/skills/document-service/workflows/discovery.md`

**Change:** Scan both `apps/` and `workers/` directories.

```bash
# Current
ls -1 apps/ | grep -v "^web$" | sort

# Proposed
ls -1 apps/ | grep -v "^web$" | sort
ls -1 workers/ | sort
```

**Output format:** Separate sections for "Apps WITH/WITHOUT docs" and "Workers WITH/WITHOUT docs".

### 2. `.claude/skills/document-service/SKILL.md`

**Change:** Update description to mention workers.

```markdown
# Current

Generate professional documentation for IntexuraOS services.

# Proposed

Generate professional documentation for IntexuraOS services (apps and workers).
```

### 3. `.claude/skills/release/workflows/full-release.md`

**Change:** Detect modified workers in Phase 1.4.

```bash
# Current
MODIFIED_SERVICES=$(git diff --name-only $LAST_TAG..HEAD -- apps/ | cut -d'/' -f2 | sort -u | grep -v web)

# Proposed
MODIFIED_APPS=$(git diff --name-only $LAST_TAG..HEAD -- apps/ | cut -d'/' -f2 | sort -u | grep -v web)
MODIFIED_WORKERS=$(git diff --name-only $LAST_TAG..HEAD -- workers/ | cut -d'/' -f2 | sort -u)
MODIFIED_SERVICES="$MODIFIED_APPS $MODIFIED_WORKERS"
echo "Modified apps: $MODIFIED_APPS"
echo "Modified workers: $MODIFIED_WORKERS"
```

### 4. `.claude/skills/coverage/SKILL.md`

**Change:** Add `workers` category option.

```markdown
# Current usage

/coverage # Full audit: all apps + packages
/coverage apps # Category audit: all apps
/coverage packages # Category audit: all packages
/coverage <name> # Targeted audit: specific app or package

# Proposed usage

/coverage # Full audit: all apps + packages + workers
/coverage apps # Category audit: all apps
/coverage packages # Category audit: all packages
/coverage workers # Category audit: all workers
/coverage <name> # Targeted audit: specific app, package, or worker
```

**Auto-detection logic update:**

1. No args → full audit (apps + packages + workers)
2. Arg is `apps`, `packages`, or `workers` → category audit
3. Arg matches directory in `apps/`, `packages/`, or `workers/` → targeted audit
4. Arg doesn't match → error with suggestions

### 5. `.claude/skills/coverage/workflows/category-audit.md`

**Change:** Handle `workers/` directory in category audit.

Add workers to the directory scanning logic alongside apps and packages.

### 6. `.claude/commands/semver-release.md`

**Change:** Update `workers/*/package.json` versions.

```bash
# Add after apps loop
# Update all workers
for worker in workers/*/package.json; do
  jq ".version = \"$NEW_VERSION\"" "$worker" > tmp.json && mv tmp.json "$worker"
done
```

**Commit command update:**

```bash
git add CHANGELOG.md package.json pnpm-lock.yaml apps/*/package.json workers/*/package.json packages/*/package.json
```

### 7. `.claude/agents/service-creator.md`

**Change:** Add worker creation flow with Phase 0 type selection.

**New Phase 0: Service Type Selection**

- Ask: "What type of service are you creating?"
  - App (Cloud Run): Persistent HTTP server, full DI, 95% coverage
  - Worker (Cloud Function): Event-driven, lightweight, scale-to-zero
- Worker-specific questions:
  - Trigger type (Pub/Sub, HTTP, Scheduled)
  - Event/topic name

**Worker-specific phases:**

- Generate structure in `workers/<worker-name>/`
- Skip API Docs Hub registration (no OpenAPI)
- Use `cloud-function` Terraform module

### 8. `.claude/commands/create-service.md`

**Change:** Add worker template section.

**Usage update:**

```
/create-service <service-name>           # Creates an app (default)
/create-service <worker-name> --worker   # Creates a worker
```

**Add new "Worker Creation Steps" section covering:**

- Worker directory structure
- Cloud Functions Framework entry point
- Terraform `cloud-function` module
- No Dockerfile (zip deployment)
- Simplified package.json

### 9. `.claude/CLAUDE.md`

**Change:** Update architecture section to include workers.

```markdown
## Architecture

apps/<app>/src/
domain/ → Business logic (no external deps)
infra/ → Adapters (Firestore, APIs, etc.)
routes/ → HTTP transport
services.ts → DI container
workers/<worker>/src/
index.ts → Cloud Functions Framework entry point
main.ts → Business logic
logger.ts → Pino logger
packages/
common-_/ → Leaf packages (Result types, HTTP helpers)
infra-_/ → External service wrappers
terraform/ → Infrastructure as code
docs/ → Documentation
```

**Add comparison table:**

| Aspect        | Apps               | Workers                                  |
| ------------- | ------------------ | ---------------------------------------- |
| Deploy Target | Cloud Run          | Cloud Functions                          |
| Framework     | Fastify            | Cloud Functions Framework                |
| Scaling       | Min 0, persistent  | Scale to zero, event-driven              |
| Entry Point   | `server.ts`        | `index.ts` with `functions.cloudEvent()` |
| DI Pattern    | Full `services.ts` | Lightweight, direct deps                 |

## Implementation Order

1. CLAUDE.md (establishes architecture context)
2. document-service (discovery.md, SKILL.md)
3. coverage (SKILL.md, category-audit.md)
4. release (full-release.md)
5. semver-release
6. service-creator
7. create-service

## Test Requirements

Each file update should be verified by:

1. Running the skill/command to ensure no syntax errors
2. Checking that workers are correctly detected/listed
3. Verifying the output format matches the design
