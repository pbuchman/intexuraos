# INT-1370: Fix Failing Deployments

## Status: Patch Ready — Requires Manual Push

The `data-insights-agent` service was retired but 4 references remain in
`.github/workflows/deploy.yml`, causing deployments to fail with
`Cannot find service [intexuraos-data-insights-agent]`.

## What needs to change

Remove these 4 lines from `.github/workflows/deploy.yml`:

1. **Line 153** — `bash cloudbuild/scripts/build-push-monitored.sh data-insights-agent apps/data-insights-agent/Dockerfile &`
2. **Line 175** — `data-insights-agent` from the `SERVICES` array
3. **Line 197** — `"data-insights-agent:DATA_INSIGHTS_AGENT"` from monolith `CLOUD_RUN_SERVICES`
4. **Line 382** — `"data-insights-agent:DATA_INSIGHTS_AGENT"` from individual `CLOUD_RUN_SERVICES`

## Why this needs manual application

The code worker's GitHub App token lacks the `workflows` permission required
to push changes to `.github/workflows/` files. This is the same permission
limitation that caused the original revert (`daadebce4`).

## How to apply

```bash
git apply docs/evidence/INT-1370-deploy-fix.patch
```

Or apply the changes manually (4 line deletions).

## Verification

- CI passes (`pnpm run ci:tracked`) — 14560 tests, all checks green
- Code review: zero issues found
- YAML syntax validated by Prettier formatter

## Timestamp

2026-04-14T05:30:00Z
