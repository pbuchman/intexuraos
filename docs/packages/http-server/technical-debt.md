# @intexuraos/http-server - Technical Debt

## Code Quality

The package is compact (two source files) and well-tested. The health check patterns are battle-tested across 19 services.

### Current Issues

#### 1. checkNotionSdk is a no-op

`checkNotionSdk()` always returns `{ status: 'ok' }` because Notion credentials are per-user. The function contains a try/catch around code that cannot throw, with an `istanbul ignore` comment on the catch branch. This health check provides no diagnostic value.

**Impact:** Low. Adds noise to health check output without providing information.
**Suggested fix:** Remove the try/catch and document clearly that this is a "presence check" rather than a connectivity check. Alternatively, remove the function entirely and let services decide whether to include a Notion check.

#### 2. Hardcoded Firestore health check timeout

The `checkFirestore` function hardcodes a 3-second timeout. This value is not configurable and may be too aggressive for cold-start scenarios or too lenient for production health probes.

**Impact:** Low. The 3-second value works in practice.
**Suggested fix:** Accept a timeout parameter with a 3000ms default.

#### 3. Package name suggests broader scope than contents

The name `http-server` suggests it provides server creation, but it only provides health checks and validation error handling. The actual server creation (`Fastify()`, plugin registration) happens in each app's `server.ts`.

**Impact:** Low. Naming is stable and changing it would require updating all consumers.

#### 4. Dependency on infra-firestore

This package depends on `@intexuraos/infra-firestore` solely for the `checkFirestore` health check. Services that do not use Firestore still transitively depend on the Firestore SDK through this package.

**Impact:** Low. The Firestore SDK is already present in all services.
**Suggested fix:** Consider accepting a Firestore instance as a parameter rather than importing `getFirestore` directly, or split `checkFirestore` into a separate optional export.

#### 5. Validation error handler relies on Fastify augmented reply

`createValidationErrorHandler` calls `reply.fail()` which requires the `intexura-plugin` from `common-http` to be registered first. This implicit dependency is documented via `import '@intexuraos/common-http'` at the top of the file but could trip up developers.

**Impact:** Low. All services register the plugin before setting the error handler.

## Future Plans

- Consider adding a `buildServer()` helper that encapsulates the common Fastify setup pattern (plugin registration, schema registration, error handler, health route)
- Evaluate adding graceful shutdown support as a shared utility
- Consider making health check functions composable via a builder pattern
