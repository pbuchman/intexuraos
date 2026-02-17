# @intexuraos/llm-pricing - Technical Debt

## Code Quality

The package handles two distinct responsibilities (pricing lookup and usage logging) and maintains good separation between them. Test coverage is comprehensive with dedicated test fixtures.

### Current Issues

#### 1. Deprecated `logUsage` function still exported

The standalone `logUsage` function is marked `@deprecated` in favor of `UsageLogger.log()` / `createUsageLogger()`, but remains exported and used via the eslint-disable comment in `index.ts`. Unknown number of downstream consumers may still reference it.

**Impact:** Low. The function works correctly; it just uses a silent logger internally, losing structured logging context.
**Suggested fix:** Audit downstream usage, migrate all callers to `createUsageLogger()`, and remove in next major version.

#### 2. UsageLogger writes per-user stats in a separate transaction

The `logUserUsage` method runs a separate Firestore transaction after the batch commit for per-user stats. This means the batch and per-user writes are not atomic -- if the transaction fails, aggregate stats are updated but per-user stats are not.

**Impact:** Low. Both operations are fire-and-forget with error logging. Slight inconsistency is acceptable for analytics data.
**Suggested fix:** Consider including per-user writes in the batch if Firestore supports the subcollection path, or accept the eventual consistency.

#### 3. `LlmPricing` type duplicates `ModelPricing` from `llm-contract`

`src/types.ts` defines `LlmPricing` which overlaps significantly with `ModelPricing` from `@intexuraos/llm-contract/pricing.ts`. `LlmPricing` adds `provider`, `model`, and `updatedAt` fields, making it a storage-layer extension of the contract type.

**Impact:** Low. The distinction is valid (contract vs. storage), but the naming similarity causes confusion.
**Suggested fix:** Rename to `StoredModelPricing` or `PricingRecord` to clarify its role as a Firestore document shape.

#### 4. No pricing cache invalidation

`PricingContext` fetches pricing once at startup and holds it in memory indefinitely. If pricing changes in app-settings-service, running instances continue using stale prices until restarted.

**Impact:** Medium. Pricing changes are infrequent, and Cloud Run instances scale to zero regularly, but long-running instances could accumulate cost calculation errors.
**Suggested fix:** Add a TTL-based refresh mechanism or subscribe to pricing change events via Pub/Sub.

## Future Plans

- Remove deprecated `logUsage` standalone function in next major version
- Consider adding pricing cache TTL with background refresh
- Evaluate moving test fixtures to a separate `@intexuraos/llm-test-utils` package to avoid shipping test code in the main package
