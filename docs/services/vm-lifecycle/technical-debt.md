# VM Lifecycle Worker — Technical Debt

**Last Updated:** 2026-03-07
**Analysis Run:** [2026-03-07 entry](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **2** | Low      |

---

## Future Plans

- **Weekend override** — Allow starting the VM on weekends via an API flag or manual scheduler trigger without requiring Terraform changes
- **Startup notifications** — Send a Slack or WhatsApp message when the VM starts or stops, providing visibility into schedule execution
- **Cost reporting** — Track and report VM uptime hours and estimated compute costs per billing period
- **Multi-VM support** — Accept VM instance parameters via the request body to manage multiple instances from the same functions
- **Status endpoint** — Add a read-only function that reports current VM state without starting or stopping

---

## Code Smells

### Low Priority

| File              | Issue                               | Impact                                                    |
| ----------------- | ----------------------------------- | --------------------------------------------------------- |
| `src/config.ts`   | Hardcoded timing constants          | Tuning polling intervals requires code changes and deploy |
| `src/start-vm.ts` | Hardcoded 5s poll in `waitForState` | State poll interval not configurable through `VM_CONFIG`  |

**Details:** All polling intervals, timeouts, and grace periods are hardcoded as constants (`10_000`, `180_000`, `600_000`, etc.) rather than configurable via environment variables. Additionally, the VM state-wait poll interval in `waitForState` is hardcoded at `5000` ms directly in the function body, not referenced through `VM_CONFIG`.

**Potential fix:** Add optional `INTEXURAOS_VM_HEALTH_POLL_INTERVAL_MS`, `INTEXURAOS_VM_HEALTH_POLL_TIMEOUT_MS`, `INTEXURAOS_VM_SHUTDOWN_GRACE_PERIOD_MS`, and `INTEXURAOS_VM_STATE_POLL_INTERVAL_MS` environment variables with the current values as defaults.

---

## Test Coverage Gaps

None. All source files have corresponding test files with coverage for:

- Auth validation (missing token, wrong token, unconfigured token)
- HTTP method validation (reject non-POST)
- Start flow (already running/healthy, running/unhealthy, not running, failure, non-Error exceptions)
- Stop flow (already stopped, running with/without tasks, orchestrator unresponsive, non-ok response, non-Error exceptions)
- Config defaults and env var overrides
- Logger initialization and level configuration

---

## TypeScript Issues

None detected. No `any` types, `@ts-ignore`, or `@ts-expect-error` directives in source files.

---

## TODOs / FIXMEs

None found in source files.

---

## SRP Violations

None. All source files are well within size limits.

---

## Resolved Issues

| Date       | Issue                                        | Resolution                                           |
| ---------- | -------------------------------------------- | ---------------------------------------------------- |
| 2026-03-03 | Test type errors from tsconfig check scope   | Added explicit type casts in test mocks (6ba7ba00)   |
| 2026-02-01 | Cloud Functions deployment failed at runtime | Switched from `tsc` to esbuild bundling (b82522d2)   |
| 2026-02-01 | Empty error objects in logs                  | Added error serializers via common-core (INT-464)    |
| 2026-01-29 | Branch coverage below 95%                    | Added v8 ignore annotations for upstream VM behavior |
| 2026-01-28 | Vitest v4 migration issues                   | Updated test patterns for new API                    |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
