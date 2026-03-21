# @intexuraos/llm-factory — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 documentation run](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Medium   |
| Test Gaps   | 0     | —        |
| Type Issues | 0     | —        |
| TODOs       | 0     | —        |
| **Total**   | **2** | Medium   |

---

## Future Plans

- Expand the factory to cover all four providers for true provider-agnostic client creation. Currently only Google (Gemini) is routed here; Anthropic, OpenAI, and Perplexity require per-app configuration.
- Consider adding a `createResearchClient()` factory that returns the full `LLMClient` interface from `llm-contract`, including `research()` and `generateImage()`.
- Evaluate client caching or connection pooling for repeated calls with the same configuration.

---

## Code Smells

### Medium Priority

| File                      | Issue                                                                                                                                                                              | Impact                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/llmClientFactory.ts` | Only Google is routed through the factory — Anthropic, OpenAI, and Perplexity require per-app configuration, making the factory incomplete as a unification point                  | Apps using non-Gemini models bypass the factory entirely                       |
| `src/llmClientFactory.ts` | `LlmGenerateClient` exposes only `generate()`, while `LLMClient` in `llm-contract` includes `research()` and optional `generateImage()` — callers needing more must cast or bypass | Constrains usefulness of the factory pattern                                   |

---

## Test Coverage Gaps

None identified. Both factory functions and the `isSupportedProvider` guard are tested. Unsupported-provider error paths are covered.

---

## TypeScript Issues

None identified.

---

## TODOs / FIXMEs

None in source files.

---

## SRP Violations

None. The single factory file handles model validation, provider routing, and client construction — all tightly related concerns.

---

## Code Duplicates

`createLlmClient` and `createToolCallingClient` both repeat the same `isValidModel` + `getProviderForModel` + Google-provider assertion pattern. A private `assertGoogleModel(model)` helper could reduce the repetition without changing semantics.

---

## Deprecations

None active. The `@intexuraos/infra-glm` dependency and Zai routing were removed in v3.3.0.

---

## Resolved Issues

| Date       | Issue                                          | Resolution                                  |
| ---------- | ---------------------------------------------- | ------------------------------------------- |
| 2026-03-12 | `infra-glm` dependency and Zai routing         | Removed with ZAI provider in v3.3.0         |
| 2026-03-07 | `createToolCallingClient` missing from factory | Added for GitHub Agent tool-calling support |

---

## Related

- [Agent Reference](agent.md)
- [Documentation Run Log](../../documentation-runs.md)
