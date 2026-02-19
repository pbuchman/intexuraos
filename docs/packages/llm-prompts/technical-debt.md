# @intexuraos/llm-prompts - Technical Debt

## Code Quality

The package is the largest in the LLM stack, with 12 domain modules. Each module follows the `PromptBuilder` pattern consistently. Zod schemas are co-located with their prompts. Test coverage is strict at 100%.

### Current Issues

#### 1. `ExternalReport` type deprecated but still exported

`ExternalReport` in `research/synthesisPrompt.ts` is deprecated in favor of `AdditionalSource`, but remains exported from the research index. Downstream consumers may still reference it.

**Impact:** Low. The type alias exists for backward compatibility.
**Suggested fix:** Audit downstream imports and remove `ExternalReport` in the next major version.

#### 2. `parseModelExtractionResponse` TODO comment not cleaned up

`modelExtractionPrompt.ts` has a `parseModelExtractionResponseWithLogging` function added (resolving the original gap), but still contains a `// TODO: Add logging version for production debugging` comment above the original `parseModelExtractionResponse` function. The logging function exists; the comment is stale.

**Impact:** Low. Confusing but harmless.
**Suggested fix:** Remove the stale TODO comment.

#### 3. Duplicate PromptBuilder/PromptDeps definitions

`PromptBuilder` and `PromptDeps` are defined in both `src/types.ts` (root) and `src/shared/types.ts`. The root `types.ts` is imported by earlier modules, while `shared/types.ts` is the canonical export. This creates confusion about which source to import from within the package.

**Impact:** Low. Both files define identical interfaces.
**Suggested fix:** Remove `src/types.ts` and update internal imports to use `src/shared/types.js`.

#### 4. Large export surface area

The package re-exports over 100 symbols through its index. This makes it a compile-time bottleneck and increases the risk of naming collisions between domains.

**Impact:** Low. Tree-shaking eliminates unused exports at build time.
**Suggested fix:** Consider sub-path exports (e.g., `@intexuraos/llm-prompts/research`) if compile times become a concern.

## Resolved

| Item                                           | Resolution                                                          | Commit   |
| ---------------------------------------------- | ------------------------------------------------------------------- | -------- |
| Missing logging in approval/model extraction   | Added `parseApprovalIntentResponseWithLogging` and `parseModelExtractionResponseWithLogging` | f451d51a |

## Future Plans

- Remove deprecated `ExternalReport` alias in next major version
- Remove stale `TODO: Add logging version` comment in `modelExtractionPrompt.ts`
- Evaluate sub-path exports for domain-level imports
- Consider extracting Zod schemas into a separate `llm-schemas` package if schema reuse outside prompts grows
