# @intexuraos/common-http — Technical Debt

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

- Evaluate centralizing Fastify module augmentations into a single declaration file
- Consider adding rate limiting middleware as a shared plugin
- Investigate adding request context propagation (traceId, userId) as first-class Fastify decorators

---

## Code Smells

### Low Priority

| Issue                                                                                                                                                                              | File                                                         | Impact                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Re-export chain creates implicit coupling — consumers import `ErrorCode` and `Result` through `common-http` rather than from `common-core`, obscuring the true dependency graph    | `src/index.ts`                                               | Works correctly but hides that callers depend on `common-core` |
| Response function naming collision — both `ok`/`err` (from `common-core`) and `ok`/`fail` (from `response.ts`) are exported; the main `ok` is aliased to `apiOk` to avoid conflict | `src/index.ts`, `src/http/response.ts`                       | Aliasing mitigates import conflicts                            |
| Fastify module augmentations spread across two files — `fastifyPlugin.ts` adds `requestId`/`startTime`/`ok`/`fail` while `fastifyAuthPlugin.ts` adds `user`/`jwtConfig`            | `src/http/fastifyPlugin.ts`, `src/auth/fastifyAuthPlugin.ts` | Harder to see the full request/reply surface at a glance       |
| JWKS cache in `jwt.ts` grows unbounded with no eviction strategy or maximum size — a new entry is added per unique JWKS URL                                                        | `src/auth/jwt.ts`                                            | No practical impact since each service uses one JWKS URL       |
| `zod` dependency exists solely for the `ZodError` type import in `handleValidationError` — actual validation schemas live in service-level code                                    | `src/http/validation.ts`                                     | Adds a dependency for a single type import                     |

---

## Test Coverage Gaps

None. All modules have comprehensive test coverage.

---

## TypeScript Issues

None in source files. Test files use `as any` for Fastify mock setup — this is expected test infrastructure pattern.

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
