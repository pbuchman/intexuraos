# Technical Debt: @intexuraos/infra-gemini

**Last Updated:** 2026-03-15

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 4     | Low      |
| Test Gaps   | 0     | —        |
| Type Issues | 1     | Low      |
| TODOs       | 0     | —        |
| **Total**   | **5** | Low      |

---

## Future Plans

- Add support for multi-modal inputs (image + text prompts)
- Add support for Gemini's code execution tool
- Extract `createRequestContext` / `trackUsage` boilerplate into `@intexuraos/llm-client-base` (shared with Claude, GPT)
- Make image model configurable via `GeminiConfig` when additional Gemini image models become available
- Align `generate()` with the 8192 token cap used by other clients, or make it configurable
- Add `AbortController` timeout support to tool calling iterations

---

## Code Smells

### Low Priority

| File                       | Issue                                                                                              | Impact                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `src/client.ts`            | `IMAGE_MODEL` hardcoded to `LlmModels.Gemini25FlashImage`, not configurable                        | Must change code if Google releases new image models |
| `src/client.ts`            | No `max_tokens` set on `generate()` calls — uses model default                                     | Inconsistent with other LLM clients using 8192       |
| `src/client.ts`            | `createRequestContext` / `trackUsage` boilerplate duplicated across LLM clients                    | Maintenance overhead                                 |
| `src/toolCallingClient.ts` | Tool calling loop has no per-iteration timeout — a slow tool `run` callback can block indefinitely | Production risk if external tools hang               |

---

## TypeScript Issues

| File            | Issue                                                                            | Count |
| --------------- | -------------------------------------------------------------------------------- | ----- |
| `src/client.ts` | `imagePart.inlineData` accessed without MIME type validation on the image data   | 1     |

**Detail:**

```ts
const imagePart = parts?.find((part) => part.inlineData !== undefined);
```

The response `inlineData.mimeType` is not verified to be `image/png` or similar. The API currently returns PNG consistently, but the MIME type should be validated defensively.

---

## TODOs / FIXMEs

No TODO/FIXME markers found in source code.

---

## Resolved Issues

| Date       | Issue                                                              | Resolution                                                  |
| ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| 2026-03-14 | Tool calling mode not enforced on first iteration                  | Added `FunctionCallingConfigMode.ANY` on iteration 1        |
| 2026-03-13 | No mechanism to recover when `maxIterations` exhausted             | Added `onExhausted` repair callback with `repairIterations` |
| 2026-03-07 | Tool calling client missing from infra-gemini                      | Implemented `createGeminiToolCallingClient`                 |
| 2026-01-27 | Logger was optional, causing inconsistent usage                    | Made `logger` mandatory via ESLint rule                     |
| 2026-01-27 | Usage tracking used ad-hoc patterns                                | Migrated to `UsageLogger` class from llm-pricing            |

---

## Related

- [README](README.md) — Developer reference
- [Agent Reference](agent.md) — Machine-readable interface
- [Documentation Run Log](../../documentation-runs.md)
