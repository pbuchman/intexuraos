# @intexuraos/llm-contract — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 documentation run](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 1     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **1** | Low      |

---

## Future Plans

- `ToolCallingModel` is currently limited to `gemini-2.5-flash`. As other providers add stable tool-calling support, extend the union and `ALL_TOOL_CALLING_MODELS` array accordingly.
- The `onExhausted` repair callback pattern in `ToolCallingClient` was added as a safety valve. Evaluate whether this belongs in the contract or should be implementation-specific.

---

## Code Smells

### Low Priority

| File                     | Issue                                                                                                                                                                        | Impact                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/supportedModels.ts` | Individual provider type aliases (`Google`, `OpenAI`, etc.) add noise to the export surface without clear consumer benefit — `LlmProvider` union is sufficient for most uses | Minor export surface bloat                        |

---

## Test Coverage Gaps

None. The package is types-only with a small set of runtime helpers (`isValidModel`, `isFastModel`, `isToolCallingModel`, `getProviderForModel`). These are exercised by consumers' test suites.

---

## TypeScript Issues

None identified.

---

## TODOs / FIXMEs

None in source files.

---

## SRP Violations

None. The four source files map cleanly to four concerns: client interface, model registry, pricing shapes, and tool-calling contract.

---

## Code Duplicates

`TokenUsage` and `NormalizedUsage` have overlapping optional fields (`webSearchCalls`, `reasoningTokens`, `groundingEnabled`). The duplication exists because `TokenUsage` captures raw provider output while `NormalizedUsage` is the standardized form returned to callers. The overlap is intentional and appropriate.

---

## Deprecations

None active. The `Zai`/`glm-4.7` models were removed in v3.3.0 — previously listed in `LLMModel` and `LlmProvider`.

---

## Resolved Issues

| Date       | Issue                                               | Resolution                                  |
| ---------- | --------------------------------------------------- | ------------------------------------------- |
| 2026-03-12 | `glm-4.7` and `glm-4.7-flash` in model union        | Removed with ZAI provider in v3.3.0         |
| 2026-03-12 | `Zai` in `LlmProvider` union                        | Removed with ZAI provider in v3.3.0         |
| 2026-03-07 | `ToolCallingClient` interface missing from contract | Added `toolCalling.ts` with full interface  |

---

## Related

- [Agent Reference](agent.md)
- [Documentation Run Log](../../documentation-runs.md)
