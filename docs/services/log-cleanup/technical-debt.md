# Log Cleanup Worker - Technical Debt

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Code Smells         | 1     | Low      |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |

Last updated: 2026-02-08

## Code Smells

### 1. Local error serializer dependency

**Severity:** Low

The worker imports `serializeError` from `@intexuraos/common-core` for logger serialization. This creates a build-time dependency on a shared package for a single utility function. Other workers (predev-lifecycle) inline a local copy instead. Neither approach is ideal -- the pattern should be consistent across all workers.

## Future Plans

### Planned Features

- **Alerting on failure** - Send a notification (Slack, email) when cleanup fails for multiple consecutive days
- **Metrics export** - Publish cleanup metrics to Cloud Monitoring for dashboards
- **Dry-run mode** - Accept a `dryRun` parameter that reports what would be deleted without deleting

### Proposed Enhancements

1. Add a dead-letter topic for undeliverable Pub/Sub messages
2. Parameterize the Cloud Scheduler cron expression via Terraform variable
3. Add retry logic within the function (currently relies solely on Pub/Sub redelivery)

## Test Coverage

### Current Status

All source files have test coverage. The test suite covers:

- CloudEvent handler success and failure paths
- Config loading with all optional parameters
- HTTP response handling (success, error status, missing data)
- Network error handling
- Logger initialization

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives in source files.

## Resolved Issues

### Historical Issues

| Date       | Issue                        | Resolution                        |
| ---------- | ---------------------------- | --------------------------------- |
| 2026-01-31 | Empty error objects in logs  | Added error serializers (INT-464) |
| 2026-01-29 | Branch coverage below 95%    | Added v8 ignore annotations       |
