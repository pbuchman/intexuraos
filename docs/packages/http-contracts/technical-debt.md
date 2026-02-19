# @intexuraos/http-contracts - Technical Debt

## Code Quality

The package is small and focused. Schemas are static constants with no runtime logic beyond the `registerCoreSchemas` helper.

### Current Issues

#### 1. ErrorCode subset diverges from common-core

The `ERROR_CODES` constant and `fastifyErrorCodeSchema.enum` list only 8 error codes, while `ErrorCode` in `common-core/errors.ts` defines 27 codes. The OpenAPI documentation underrepresents the actual error codes that services can return.

**Impact:** Medium. API consumers see incomplete error code documentation. Domain-specific codes like `WORKER_NOT_CONFIGURED`, `NOTION_NOT_CONNECTED`, `RATE_LIMITED`, `LOCKED`, `GONE`, `PRECONDITION_FAILED`, and `UNPROCESSABLE_ENTITY` are missing from the contracts.
**Suggested fix:** Either auto-generate the enum from the `ErrorCode` type or explicitly list all codes. Consider a build-time check that validates parity between `http-contracts` error codes and `common-core` ErrorCode.

#### 2. Duplicated schema definitions

`DiagnosticsSchema` exists in both `openapi-schemas.ts` (using `$ref: '#/components/schemas/...'`) and `fastify-schemas.ts` (using `$ref: 'Diagnostics#'`). The field definitions are identical but maintained separately, creating a risk of divergence.

**Impact:** Low. The schemas are simple and stable.
**Suggested fix:** Consider generating Fastify schemas from OpenAPI schemas programmatically.

#### 3. No TypeScript type alignment validation

There is no mechanism ensuring that the JSON Schema definitions match the TypeScript types in `common-http/response.ts`. The `Diagnostics` interface in TypeScript and the `DiagnosticsSchema` JSON Schema could diverge silently.

**Impact:** Medium. Schema/type mismatches cause runtime validation surprises.
**Suggested fix:** Add a test that validates JSON schemas against TypeScript types, or adopt a schema-first approach (e.g., generate types from schemas or vice versa).

#### 4. No dependency on common-core

The package has zero dependencies and hardcodes error code values. This means error codes exist in three places: `common-core/errors.ts`, `openapi-schemas.ts`, and `fastify-schemas.ts`.

**Impact:** Low. Adds maintenance burden when introducing new error codes.

## Resolved Debt

None archived yet.

## Future Plans

- Investigate generating schemas from TypeScript types using `ts-json-schema-generator` or similar
- Add service-specific schema extension patterns (documented approach for services to add their own schemas)
- Consider adding request body schemas for common patterns (pagination, filtering)
- Evaluate adding response schema validation in test environments
