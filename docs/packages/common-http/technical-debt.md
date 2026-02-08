# @intexuraos/common-http - Technical Debt

## Code Quality

The package serves as the HTTP middleware layer for all services. Code quality is high with well-separated concerns across auth, HTTP, and logging modules.

### Current Issues

#### 1. Re-export chain creates implicit coupling

The package re-exports symbols from both `@intexuraos/common-core` and `@intexuraos/llm-utils`. While convenient, this creates a transitive dependency path where consumers import core types through `common-http` rather than from the source package. Some consumers may not realize they depend on `common-core` indirectly.

**Impact:** Low. Works correctly but obscures the dependency graph.
**Suggested fix:** Consider deprecating re-exports and requiring consumers to import directly from source packages.

#### 2. Response function naming collision

The package exports both `ok`/`err` from `common-core` and `ok`/`fail` from `response.ts`. The main `ok` is aliased to `apiOk` on export, but the naming overlap can cause confusion.

**Impact:** Low. The aliasing (`ok as apiOk`, `fail as apiFail`) mitigates import conflicts.

#### 3. Fastify module augmentation spread

The package augments the `fastify` module in two separate files (`fastifyPlugin.ts` adds `requestId`/`startTime`/`ok`/`fail`, `fastifyAuthPlugin.ts` adds `user`/`jwtConfig`). These augmentations are scattered and not centralized.

**Impact:** Low. Works correctly but makes it harder to see the full request/reply surface.
**Suggested fix:** Consider a single `fastify.d.ts` file that centralizes all augmentations.

#### 4. JWKS cache has no eviction strategy

The `jwksCache` in `jwt.ts` grows unbounded. Each unique JWKS URL adds an entry that persists for the process lifetime. In practice this is fine since services use a single JWKS URL, but it lacks a maximum size or TTL.

**Impact:** None in practice. Each service uses one JWKS URL.

#### 5. Zod dependency used only for handleValidationError

The `zod` dependency exists solely for the `handleValidationError` function's `ZodError` type import. The actual validation schemas live in service-level code.

**Impact:** Low. Adds a dependency for a single type import.
**Suggested fix:** Consider accepting a generic validation error shape instead of coupling to Zod.

## Future Plans

- Evaluate centralizing Fastify module augmentations into a single declaration file
- Consider adding rate limiting middleware as a shared plugin
- Investigate adding request context propagation (traceId, userId) as first-class Fastify decorators
