# @intexuraos/internal-clients — Technical Debt

**Last Updated:** 2026-03-15

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 5     | Medium   |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **5** | Medium   |

---

## Future Plans

| Area                | Description                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Additional clients  | Add clients for other internal services (e.g., notion-service, calendar-agent) following the same pattern |
| Response validation | Add runtime schema validation for API responses using zod                                                 |
| Retry logic         | Add configurable retry with exponential backoff to `fetchWithAuth`                                        |

---

## Code Smells

### Medium Priority

| Issue                                                                                                                                                                                                                                                                      | File                                                 | Impact                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Duplicate HTTP logic between `fetchWithAuth` and `createUserServiceClient` — the user-service client uses raw `fetch()` calls directly rather than delegating to `fetchWithAuth`, creating two parallel implementations of the same auth-header and error-handling pattern | `src/user-service/client.ts`, `src/shared/errors.ts` | Changes to auth header logic must be applied in two places |
| Response body parsing casts to `as { success: boolean; data: ... }` without runtime validation — if the user-service response contract changes, the client silently misinterprets data                                                                                     | `src/user-service/client.ts`                         | Risk increases if user-service evolves independently       |

### Low Priority

| Issue                                                                                                                                                                                                      | File                                                      | Impact                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `shared/http.ts` is a pass-through re-export of `errors.ts` — exists for backward compatibility but adds indirection; `fetchWithAuth` lives in `errors.ts` which is a misleading filename                  | `src/shared/http.ts`, `src/shared/errors.ts`              | Naming confusion only                                             |
| `OAuthProvider` type now includes `'github'` but the `resolveGitHubUsername` call does not use the `OAuthProvider` type — the GitHub and OAuth pathways are coupled by name but separate by implementation | `src/user-service/types.ts`, `src/user-service/client.ts` | Minor conceptual inconsistency                                    |
| `providerToKeyField` uses an ESLint disable for `explicit-function-return-type` and relies on TypeScript's control flow narrowing                                                                          | `src/user-service/client.ts`                              | Cosmetic; an explicit return type would make the contract clearer |

---

## Test Coverage Gaps

None. Package maintains near-100% branch coverage.

---

## TypeScript Issues

None. Zero `any` types in source files.

---

## TODOs / FIXMEs

None found in source files.

---

## Code Quality Notes

- All user IDs are URL-encoded with `encodeURIComponent()` to handle Auth0 pipe-delimited IDs (`auth0|...`)
- `reportLlmSuccess` is explicitly best-effort with a silent catch block
- Null-to-undefined conversion in `getApiKeys` handles JSON serialization differences

---

## Resolved Issues

None archived yet.

---

## Related

- [README](README.md) — API reference
- [Agent Interface](agent.md)
- [Documentation Run Log](../../documentation-runs.md)
