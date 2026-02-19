# VM Lifecycle Worker - Technical Debt

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Code Smells         | 1     | Low      |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |

Last updated: 2026-02-19

## Code Smells

### 1. Hardcoded timing constants in config

**Severity:** Low
**File:** `workers/vm-lifecycle/src/config.ts`

All polling intervals, timeouts, and grace periods are hardcoded as constants (`10_000`, `180_000`, `600_000`, etc.) rather than configurable via environment variables. Additionally, the VM state-wait poll interval in `waitForState` is hardcoded at `5000` ms (5 seconds) directly in the function body, not even referenced through `VM_CONFIG`. This makes tuning startup and shutdown timing require code changes and redeployment.

**Potential fix:** Add optional `INTEXURAOS_VM_HEALTH_POLL_INTERVAL_MS`, `INTEXURAOS_VM_HEALTH_POLL_TIMEOUT_MS`, `INTEXURAOS_VM_SHUTDOWN_GRACE_PERIOD_MS`, and `INTEXURAOS_VM_STATE_POLL_INTERVAL_MS` environment variables with the current values as defaults.

## Future Plans

### Planned Features

- **Weekend override** - Allow starting the VM on weekends via an API flag or manual scheduler trigger
- **Startup notifications** - Send a Slack or WhatsApp message when the VM starts or stops
- **Cost reporting** - Track and report VM uptime hours and estimated costs

### Proposed Enhancements

1. Make polling intervals and timeouts configurable via environment variables
2. Add Cloud Monitoring metrics for startup duration and shutdown task counts
3. Support managing multiple VM instances via request body parameters
4. Add a status endpoint that reports current VM state without starting or stopping

## Test Coverage

### Current Status

All source files have test coverage. The test suite covers:

- Auth validation (missing token, wrong token, unconfigured token)
- HTTP method validation (reject non-POST)
- Start flow (already running/healthy, running/unhealthy, not running, failure)
- Stop flow (already stopped, running with tasks, running without tasks, orchestrator unresponsive)
- Config defaults and env var overrides
- Logger initialization

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives in source files.

## Resolved Issues

### Historical Issues

| Date       | Issue                                        | Resolution                                         |
| ---------- | -------------------------------------------- | -------------------------------------------------- |
| 2026-02-01 | Cloud Functions deployment failed at runtime | Switched from `tsc` to esbuild bundling (b82522d2) |
| 2026-01-31 | Empty error objects in logs                  | Added error serializers (INT-464)                  |
| 2026-01-29 | Branch coverage below 95%                    | Added v8 ignore annotations                        |
| 2026-01-28 | Vitest v4 migration issues                   | Updated test patterns                              |
