# Continuity Ledger — 030-synthesis-source-attribution

## Goal

Add deterministic source attribution to synthesis output so users can see which sources actually contributed to which sections.

## Success Criteria

1. Each synthesis section ends with `Attribution: Primary=S1; Secondary=U1; Constraints=; UNK=false`
2. Code-generated breakdown appended showing scorecard and per-source usage
3. `attributionStatus` stored in Firestore (`complete` | `incomplete` | `repaired`)
4. No hallucinated attributions—breakdown is derived strictly from parsed markers

---

## Status

### Done

- [x] 1-0-attribution-types.md
- [x] 1-1-attribution-parsing.md
- [x] 1-2-section-parsing.md
- [x] 1-3-validation.md
- [x] 1-4-breakdown-generator.md
- [x] 1-5-attribution-tests.md
- [x] 2-0-prompt-source-ids.md
- [x] 2-1-prompt-inject-rules.md
- [x] 2-2-prompt-tests.md
- [x] 3-0-repair-usecase.md
- [x] 3-1-post-processing.md
- [x] 3-2-firestore-field.md
- [x] 4-0-integration-test.md
- [x] 4-1-final-verification.md

### Now

(complete)

### Next

(none)

---

## Key Decisions

| Decision                                      | Rationale                                      |
| --------------------------------------------- | ---------------------------------------------- |
| Store `attributionStatus` as Firestore field  | User chose this over JSON wrapper              |
| Use GeminiAdapter for repair                  | Reuse existing synthesizer                     |
| Append breakdown only (no structured storage) | Simpler, matches user preference               |
| Non-`##` heading for injected sections        | Avoids parser confusion if model echoes prompt |

---

## Implementation Summary

### Tier 1 — Attribution Module (packages/common-core/src/prompts/attribution.ts)

- Types: `SourceId`, `SourceMapItem`, `AttributionLine`, `ParsedSection`, `ValidationResult`, `BreakdownEntry`
- Functions: `parseAttributionLine()`, `parseSections()`, `buildSourceMap()`, `validateSynthesisAttributions()`, `generateBreakdown()`
- Tests: 619 lines with comprehensive coverage
- Exported from `packages/common-core/src/index.ts`

### Tier 2 — Prompt Modifications (packages/common-core/src/prompts/synthesisPrompt.ts)

- Source headings changed from `### GPT-4` to `### S1 (LLM report; model: GPT-4)`
- Additional sources use `### U1 (Additional source; label: Label)`
- Added `buildSourceIdMapSection()` helper generating plain text table
- Added `ATTRIBUTION_RULES` constant with format and category explanations
- Injected rules after "## Sources Used" in both contextual and legacy paths
- Added "Attribute sources" task item in "Your Task" section

### Tier 3 — ResearchAgent Integration (apps/research-agent)

- Created `repairAttribution.ts` usecase for fixing malformed attributions
- Added `AttributionStatus` type to `Research.ts` domain model
- Added post-processing to `runSynthesis.ts`:
  - Build source map from reports and additional sources
  - Validate attributions against allowed source IDs
  - Attempt single repair if validation fails
  - Parse sections and generate breakdown
  - Append breakdown to content
  - Track `attributionStatus` ('complete' | 'incomplete' | 'repaired')
  - Save to Firestore with processed content and status

### Tier 4 — Verification

- All tests pass (46 synthesis prompt tests, 7 repair attribution tests)
- 95% coverage maintained
- CI passes

---

## Open Questions

(none)

---

## Blockers

(none)
