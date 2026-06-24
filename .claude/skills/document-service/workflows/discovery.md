# Discovery Workflow

Run when `/document-service` is invoked without a service name.

## Purpose

Show available services, workers, and packages with their documentation status so users can choose what to document.

## Steps

### Step 1: Scan Components

```bash
# Scan apps (excluding web frontend)
ls -1 apps/ | grep -v "^web$" | sort

# Scan workers
ls -1 workers/ | sort

# Scan packages
ls -1 packages/ | sort
```

### Step 2: Check Documentation Status

For each app and worker:

```bash
# Check if docs exist
test -d "docs/services/<service-name>" && echo "HAS_DOCS" || echo "NO_DOCS"

# Get last update date if docs exist
grep -h "^## .* — <service-name>" docs/documentation-runs.md | tail -1 | sed 's/^## //'
```

For each package:

```bash
# Check if docs exist
test -d "docs/packages/<package-name>" && echo "HAS_DOCS" || echo "NO_DOCS"
```

### Step 3: Display Component List

**Output format:**

```
Available components to document:

Apps WITH existing docs:
  + user-service          (last: 2026-02-08)
  + whatsapp-service      (last: 2026-02-08)
  + notes-agent           (last: 2026-02-08)
  ...

Apps WITHOUT docs:
    (none)

Workers WITH existing docs:
  + orchestrator          (last: 2026-02-08)
  + claude-worker         (last: 2026-02-08)

Workers WITHOUT docs:
    (none)

Packages WITH existing docs:
  + common-core           (last: 2026-02-08)
  + infra-claude          (last: 2026-02-08)
  ...

Packages WITHOUT docs:
    (none)

Validation reports:
  + HTTP contracts        (2026-02-08)
  + Pub/Sub contracts     (2026-02-08)
  + AI models             (2026-02-08)
  + Firestore collections (2026-02-08)
  + Package dependencies  (2026-02-08)
  + Environment variables (2026-02-08)

Run: /document-service <service-name>     # Document one service
     Team mode (see team.md)              # Document all + cross-validate
```

## Priority Order (for autonomous/team mode)

1. **First**: Services with no documentation
2. **Second**: Services with stale documentation (significant code changes since last doc run)
3. **Third**: Services needing refresh (minor changes)

## Checking Staleness

Compare git commit date for component vs last documentation run:

```bash
# Last app commit
git log -1 --format="%ci" apps/<service-name>/

# Last worker commit
git log -1 --format="%ci" workers/<worker-name>/

# Last package commit
git log -1 --format="%ci" packages/<package-name>/

# Last documentation run
grep -h "^## .* — <service-name>" docs/documentation-runs.md | tail -1
```

If component has commits after last doc run, it's stale.

## Diff-Based Discovery (for Team Mode)

When doing a full documentation run, use git diff against a base branch:

```bash
# Find all modified apps
git diff --name-only origin/main...HEAD -- apps/ | cut -d/ -f2 | sort -u

# Find all modified workers
git diff --name-only origin/main...HEAD -- workers/ | cut -d/ -f2 | sort -u

# Find all modified packages
git diff --name-only origin/main...HEAD -- packages/ | cut -d/ -f2 | sort -u
```

This provides a precise list of components that changed since the base branch, which is more efficient than checking all components for staleness.
