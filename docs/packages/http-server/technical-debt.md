# @intexuraos/http-server — Technical Debt

**Last Updated:** 2026-03-15

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 5     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **5** | Low      |

---

## Future Plans

- Consider adding a `buildServer()` helper that encapsulates the common Fastify setup pattern (plugin registration, schema registration, error handler, health route)
- Evaluate adding graceful shutdown support as a shared utility
- Consider making health check functions composable via a builder pattern

---

## Code Smells

### Low Priority

| Issue                                                                                                                                                                                                                    | File                        | Impact                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------- |
| `checkNotionSdk` is a no-op that always returns `{ status: 'ok' }` — contains a try/catch around code that cannot throw, with a v8 ignore on the catch branch                                                            | `src/health.ts`             | Adds noise to health check output without providing diagnostic value   |
| Hardcoded 3-second timeout in `checkFirestore` — not configurable, may be too aggressive for cold-start scenarios                                                                                                        | `src/health.ts`             | Works in practice; cold-start edge cases remain untested               |
| Package name `http-server` suggests server creation but the package only provides health checks and validation error handling — actual server creation happens in each app                                               | n/a                         | Naming is stable; renaming would require updating all 19 consumers     |
| Depends on `@intexuraos/infra-firestore` solely for `checkFirestore` — services that do not use Firestore still transitively depend on the Firestore SDK                                                                 | `src/health.ts`             | Firestore SDK already present in all services; no practical overhead   |
| `createValidationErrorHandler` calls `reply.fail()` which requires `intexura-plugin` from `common-http` to be registered first — this implicit dependency is documented via an import side-effect at the top of the file | `src/validation-handler.ts` | All services register the plugin before the error handler; risk is low |

---

## Test Coverage Gaps

None.

---

## TypeScript Issues

None.

---

## TODOs / FIXMEs

None found in source files.

---

## Resolved Issues

None archived yet.

---

## Related

- [README](README.md) — API reference
- [Agent Interface](agent.md)
- [Documentation Run Log](../../documentation-runs.md)
