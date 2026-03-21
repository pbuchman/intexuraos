# @intexuraos/llm-pricing — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 documentation run](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 1     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 1     | Low      |
| **Total**   | **2** | Low      |

---

## Future Plans

- The `logUsage` standalone function is deprecated. All callers should migrate to `UsageLogger` / `createUsageLogger()` for proper structured logging. The deprecated function can be removed once no callers remain.
- `LlmPricing` interface in `types.ts` partially duplicates `ModelPricing` from `llm-contract`. Evaluate whether `LlmPricing` can be replaced with `ModelPricing` to eliminate the duplication.

---

## Code Smells

### Low Priority

| File                 | Issue                                                                                                                                                                                                  | Impact                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `src/usageLogger.ts` | `logUserUsage` uses a Firestore transaction to handle the exists-or-create pattern, which adds a round-trip for every new user-day pair. A `set(..., { merge: true })` would be equivalent and cheaper | Minor Firestore cost for first call per user per day |

---

## Test Coverage Gaps

None identified. `UsageLogger`, `PricingContext`, `createPricingContext`, `fetchAllPricing`, all three usage sinks, and `isUsageLoggingEnabled` are tested. The deprecated `logUsage` function is covered in the legacy test suite.

---

## TypeScript Issues

None identified.

---

## TODOs / FIXMEs

| File                 | Comment                                                                | Priority |
| -------------------- | ---------------------------------------------------------------------- | -------- |
| `src/usageLogger.ts` | `@deprecated` on `logUsage` — pending removal once all callers migrate | Low      |

---

## SRP Violations

`pricingClient.ts` handles two distinct concerns: HTTP fetching (`fetchAllPricing`) and the in-memory pricing context (`PricingContext`). These could be split into separate files, but the current size does not justify the split.

---

## Code Duplicates

`types.ts` defines `LlmPricing` which largely mirrors `ModelPricing` from `@intexuraos/llm-contract`. Both have `inputPricePerMillion`, `outputPricePerMillion`, and optional cache/search fields. The distinction is that `LlmPricing` adds `provider`, `model`, and `updatedAt` for storage purposes. Consider whether `LlmPricing` can extend `ModelPricing`.

---

## Deprecations

| Item       | Location             | Replacement                                 | Deadline |
| ---------- | -------------------- | ------------------------------------------- | -------- |
| `logUsage` | `src/usageLogger.ts` | `UsageLogger.log()` / `createUsageLogger()` | TBD      |

---

## Resolved Issues

| Date       | Issue                                   | Resolution                          |
| ---------- | --------------------------------------- | ----------------------------------- |
| 2026-03-12 | Pricing map included `glm-4.7` entries  | Removed with ZAI provider in v3.3.0 |

---

## Related

- [Agent Reference](agent.md)
- [Documentation Run Log](../../documentation-runs.md)
