# INT-1370: Fix Failing Deployments

**Date:** 2026-04-13
**Status:** Planned (SIMPLE)

## Summary

Web deployments are failing because the retired `data-insights-agent` service is still referenced in `.github/workflows/deploy.yml`. The service was removed in commit `c12cb8de3` but the deploy.yml changes had to be reverted (`daadebce4`) because the GitHub App token lacks `workflows` permission.

## Root Cause

The `gcloud run services describe intexuraos-data-insights-agent` call fails with `Cannot find service` because the Cloud Run service no longer exists, causing the web deployment job to exit with code 1.

## Fix

Remove all 4 `data-insights-agent` references from `.github/workflows/deploy.yml`:

1. Line ~153: Docker image build command in monolith deploy
2. Line ~175: Service name in `SERVICES` array for Cloud Run deploy
3. Line ~197: Entry in `CLOUD_RUN_SERVICES` array (monolith web config fetch)
4. Line ~382: Entry in `CLOUD_RUN_SERVICES` array (individual target web deploy)

No other files are affected — the web app (`apps/web/src/config.ts`) already has no `DATA_INSIGHTS` references.
