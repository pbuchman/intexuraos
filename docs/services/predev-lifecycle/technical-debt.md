# Pre-Dev Lifecycle Worker - Technical Debt

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Code Smells         | 2     | Medium   |
| TypeScript Issues   | 1     | Low      |
| Code Duplicates     | 1     | Low      |

Last updated: 2026-02-08

## Code Smells

### 1. Gateway file size and eslint-disable directives

**Severity:** Medium
**File:** `workers/predev-lifecycle/src/functions/gateway.ts` (280 lines)

The gateway file disables five ESLint rules at the top:

- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-unsafe-member-access`
- `@typescript-eslint/no-unsafe-assignment`
- `@typescript-eslint/no-unsafe-call`
- `@typescript-eslint/no-unnecessary-condition`

These are necessary because the Cloud Functions Framework provides `Express`-like request/response objects without strong TypeScript types. The gateway also combines multiple concerns: HTML rendering, SSE proxying, HTTP proxying, branch-lock API, and state management.

**Potential fix:** Define typed request/response interfaces that wrap the Cloud Functions types, eliminating the need for eslint-disable directives. Extract the proxy logic and Starting page HTML into separate modules.

### 2. Heavy v8 ignore coverage annotations

**Severity:** Medium
**Files:** `state.ts`, `gateway.ts`, `webhook.ts`

Several files use extensive `v8 ignore` blocks to exclude code from coverage. While each annotation has a valid category and reason, the volume suggests some functions are structured in ways that make them hard to test. The `setStartingIfStopped()` transaction in `state.ts` has the most annotations.

**Potential fix:** Refactor Firestore transaction logic to accept injected dependencies, making branches testable without requiring actual Firestore state.

## TypeScript Issues

### 1. Multiple `any` types in gateway proxy functions

**Severity:** Low
**File:** `workers/predev-lifecycle/src/functions/gateway.ts`

The `proxyRequest`, `proxySSE`, and `gateway` functions use `any` for request and response parameters. This is a consequence of the Cloud Functions Framework type limitations.

## Code Duplicates

### 1. serializeError local copy

**Severity:** Low
**File:** `workers/predev-lifecycle/src/lib/serializeError.ts`

The worker maintains a local copy of the `serializeError` function instead of importing from `@intexuraos/common-core`. The file header explains this is intentional ("this worker doesn't depend on @intexuraos/common-core"), but it creates a maintenance burden if the canonical implementation changes.

## Future Plans

### Planned Features

- **Authentication** - Add Auth0 or IAP-based authentication to the gateway to restrict access
- **Multi-environment support** - Support multiple pre-dev instances for different teams or purposes
- **Startup notifications** - Send a Slack/WhatsApp message when the VM starts or stops
- **Uptime dashboard** - Track VM uptime and idle patterns for cost optimization

### Proposed Enhancements

1. Extract gateway proxy logic into a shared module for reuse and testability
2. Add proper TypeScript types for Cloud Functions request/response objects
3. Implement graceful shutdown notification to connected SSE clients before idle shutdown
4. Add health check monitoring for the report-ready callback

## Test Coverage

### Current Status

All functions and library modules have test coverage. Coverage threshold is 95% across lines, functions, branches, and statements.

### Coverage Areas

- Gateway: State-dependent routing, branch-lock API, SSE proxy setup
- Webhook: Signature verification, branch logic, Pub/Sub publishing
- Idle-check: Timeout calculation, VM shutdown flow
- Report-ready: Validation, state transition
- State: Firestore CRUD, transaction logic
- VmControl: MIG resize calls

## Resolved Issues

### Historical Issues

| Date       | Issue                                  | Resolution                                   |
| ---------- | -------------------------------------- | -------------------------------------------- |
| 2026-02-06 | Redirect loop on Starting page         | Switched to JS polling with reload (INT-511) |
| 2026-02-03 | Duplicate Content-Type header in proxy | Filter content-type before forwarding        |
| 2026-02-03 | Binary content corruption in proxy     | Use arrayBuffer for binary responses         |
| 2026-02-02 | Branch switch during demos             | Added branch lock feature                    |
| 2026-01-31 | Empty error objects in logs            | Added error serializers (INT-464)            |
| 2026-01-31 | Mock structure errors in tests         | Fixed test mock shapes                       |
