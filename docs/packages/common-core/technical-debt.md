# @intexuraos/common-core - Technical Debt

## Code Quality

The package maintains high code quality as the foundational leaf package. All modules are small, well-typed, and have comprehensive test coverage.

### Current Issues

#### 1. ErrorCode proliferation

`ErrorCode` in `errors.ts` contains domain-specific codes that belong in their respective service packages rather than in a core utility package. The full set of domain-specific codes has grown to: `NOTION_NOT_CONNECTED`, `PAGE_NOT_CONFIGURED`, `RESEARCH_NOT_COMPLETED`, `NO_SYNTHESIS`, `ALREADY_EXPORTED`, `NOTION_UNAUTHORIZED`, `WORKER_NOT_CONFIGURED`, `INVALID_WORKER`, `WORKER_UNHEALTHY`, `WORKER_UNAVAILABLE`, `INVALID_NONCE`, `NONCE_EXPIRED`, `NOT_OWNER`, `TASK_NOT_CANCELLABLE`. These leak domain knowledge into the shared layer.

**Impact:** Low. Adding new service-specific error codes requires modifying a shared package.
**Suggested fix:** Move domain-specific error codes to service-level packages. Keep only generic HTTP-aligned codes in `common-core`.

#### 2. Dual error systems

The package exports two parallel error mechanisms: `Result<T, E>` (functional) and `IntexuraOSError` (exception-based). Both are actively used throughout the codebase, creating inconsistency in error handling patterns.

**Impact:** Medium. Contributors must decide which pattern to use per-call-site.
**Suggested fix:** Establish clear guidelines: `Result` for domain logic, `IntexuraOSError` for infrastructure/auth failures.

#### 3. ServiceErrorCode vs ErrorCode overlap

`ServiceErrorCodes` (`serviceErrorCodes.ts`) and `ErrorCode` (`errors.ts`) both define `UNAUTHORIZED`, `NOT_FOUND`, and `VALIDATION_ERROR`-like codes, but they serve different purposes and are not type-compatible.

**Impact:** Low. May cause confusion when developers pick the wrong error code type.
**Suggested fix:** Add clear documentation distinguishing API-level errors (`ErrorCode`) from service execution errors (`ServiceErrorCode`).

#### 4. v8 ignore comments in serializeError

The `serializeError` function in `errors.ts` has multiple v8 ignore directives for branches that are difficult to exercise in tests (stack truncation, undefined stack). These are properly categorized but indicate complexity that could potentially be simplified.

**Impact:** None functionally. The ignore annotations follow project conventions.

## Resolved Debt

None archived yet.

## Future Plans

- Consider extracting tracing utilities into a dedicated `common-tracing` package if tracing concerns grow beyond `X-Trace-Id`
- Evaluate whether `ServiceFeedback` should move to a dedicated contract package as the feedback system matures
- Consider adding a `Result.map()` / `Result.flatMap()` combinator API for chaining operations
