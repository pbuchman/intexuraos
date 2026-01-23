# Discovery Workflow

Run when `/document-service` is invoked without a service name.

## Purpose

Show available services and their documentation status so users can choose what to document.

## Steps

### Step 1: Scan Services

```bash
ls -1 apps/ | grep -v "^web$" | sort
```

### Step 2: Check Documentation Status

For each service:

```bash
# Check if docs exist
test -d "docs/services/<service-name>" && echo "HAS_DOCS" || echo "NO_DOCS"

# Get last update date if docs exist
grep -h "^## .* — <service-name>" docs/documentation-runs.md | tail -1 | sed 's/^## //'
```

### Step 3: Display Service List

**Output format:**

```
Available services to document:

Services WITH existing docs:
  ✓ user-service          (last: 2025-01-10)
  ✓ whatsapp-service      (last: 2025-01-08)
  ✓ todos-service         (last: 2025-01-05)

Services WITHOUT docs:
    actions-agent
    bookmarks-service
    calendar-service
    data-insights-service
    llm-orchestrator
    notifications-service
    places-service
    research-agent
    scraper-service
    share-service
    subscriptions-service
    triggers-service
    webhooks-service

Website status:
  Marketing pages:  3/14 services documented
  Developer docs:   3/14 services documented

Run: /document-service <service-name>
```

## Priority Order (for autonomous mode)

1. **First**: Services with no documentation
2. **Second**: Services with stale documentation (significant code changes since last doc run)
3. **Third**: Services needing refresh (minor changes)

## Checking Staleness

Compare git commit date for service vs last documentation run:

```bash
# Last service commit
git log -1 --format="%ci" apps/<service-name>/

# Last documentation run
grep -h "^## .* — <service-name>" docs/documentation-runs.md | tail -1
```

If service has commits after last doc run, it's stale.
