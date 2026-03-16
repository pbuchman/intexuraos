# Technical Debt: @intexuraos/infra-otel

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 documentation run](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Low      |
| Test Gaps   | 1     | Low      |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **3** | —        |

---

## Future Plans

- Document `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG` environment variables for tunable sampling rate
- Consider consolidating OTel log transport configuration from infra-sentry into this package
- Add integration test with local OTLP receiver for full SDK bootstrap verification
- Consider exposing `exportIntervalMillis` as a configurable environment variable

---

## Code Smells

### Low Priority

| File              | Issue                                                         | Impact                                                                                        |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/register.ts` | Metric export interval hardcoded at `30_000` ms               | Not configurable without a code change; 30s is reasonable but may not suit all traffic levels |
| `src/register.ts` | Default sampler (`ParentBasedAlwaysOnSampler`) not documented | High-volume services may unknowingly export 100% of traces; no guidance on sampling config    |

---

## Test Coverage Gaps

| File/Module       | Coverage | Missing                                                                     |
| ----------------- | -------- | --------------------------------------------------------------------------- |
| `src/register.ts` | 0%       | Full SDK startup path requires live OTLP collector; unit tests not feasible |

---

## TypeScript Issues

None.

---

## TODOs / FIXMEs

None found in source code.

---

## Architecture Notes

### Log Forwarding Split Across Packages

Traces and metrics are exported by this package. Pino log forwarding to Dash0 (logs → OTLP) is handled by `@intexuraos/infra-sentry` via `pino-opentelemetry-transport`. The `PinoInstrumentation` was removed from `getInstrumentations()` in commit `0338e04f` because Node loader hooks conflict with tsx. The two configurations must use consistent endpoint and auth token values.

**Impact:** Low. Currently consistent, but a future refactor of either package could introduce divergence.

**Recommendation:** Consider consolidating all OTel configuration into this package.

---

## Resolved Issues

| Date       | Issue                                            | Resolution                                    |
| ---------- | ------------------------------------------------ | --------------------------------------------- |
| 2026-02-16 | `PinoInstrumentation` not activating under tsx   | Removed; log forwarding moved to infra-sentry |
| 2026-02-16 | `./register` export pointed to `.ts` source file | Fixed to point to compiled `dist/register.js` |

---

## Related

- [README](README.md) — Package overview and API reference
- [Agent Reference](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
