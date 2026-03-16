# @intexuraos/http-contracts — Technical Debt

**Last Updated:** 2026-03-15

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 4     | Medium   |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **4** | Medium   |

---

## Future Plans

- Investigate generating schemas from TypeScript types using `ts-json-schema-generator` or similar
- Add service-specific schema extension patterns (documented approach for services to add their own schemas)
- Consider adding request body schemas for common patterns (pagination, filtering)
- Evaluate adding response schema validation in test environments

---

## Code Smells

### Medium Priority

| Issue                                                                                                                                                                                                                   | File                                               | Impact                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERROR_CODES` constant and `fastifyErrorCodeSchema.enum` list only 8 codes while `ErrorCode` in `common-core` defines 27 — OpenAPI documentation underrepresents actual error codes services can return                 | `src/openapi-schemas.ts`, `src/fastify-schemas.ts` | API consumers see incomplete error code documentation; domain-specific codes such as `WORKER_NOT_CONFIGURED`, `NOTION_NOT_CONNECTED`, `RATE_LIMITED`, `LOCKED` are missing |
| No TypeScript type alignment validation — no mechanism ensures that JSON Schema definitions match TypeScript types in `common-http/response.ts`; `Diagnostics` interface and `DiagnosticsSchema` could diverge silently | `src/openapi-schemas.ts`                           | Schema/type mismatches cause runtime validation surprises                                                                                                                  |

### Low Priority

| Issue                                                                                                                                                                                                                              | File                                               | Impact                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `DiagnosticsSchema` definition duplicated across `openapi-schemas.ts` (uses `$ref: '#/components/schemas/...'`) and `fastify-schemas.ts` (uses `$ref: 'Diagnostics#'`) — field definitions are identical but maintained separately | `src/openapi-schemas.ts`, `src/fastify-schemas.ts` | Risk of divergence; schemas are simple and stable today |
| Error code values hardcoded in three places: `common-core/errors.ts`, `openapi-schemas.ts`, `fastify-schemas.ts` — no shared source of truth                                                                                       | `src/openapi-schemas.ts`, `src/fastify-schemas.ts` | Maintenance burden when introducing new error codes     |

---

## Test Coverage Gaps

None. Schema constants have comprehensive test coverage.

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
