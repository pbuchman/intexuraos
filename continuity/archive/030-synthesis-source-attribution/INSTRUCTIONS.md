# Process Manual — 030-synthesis-source-attribution

## Overview

Add provenance-safe source attribution to synthesis output. The system assigns neutral IDs (`S1..Sn` for LLM reports, `U1..Um` for user sources), instructs the LLM to output Attribution markers per section, then code validates/repairs markers and generates a deterministic "Source Utilization Breakdown" appendix.

## Codebase Reference

**CRITICAL:** Before writing any code, read `.claude/CLAUDE.md` for codebase rules:

- 95% test coverage required (NEVER modify thresholds)
- Use `npm run ci` for verification
- Domain logic has no external deps
- Routes use `getServices()`, not direct infra imports
- Logger must be passed as dependency to usecases

## Folder Structure

```
continuity/030-synthesis-source-attribution/
├── INSTRUCTIONS.md              # This file
├── CONTINUITY.md                # Progress ledger
├── 1-0-attribution-types.md     # Types for attribution parsing
├── 1-1-attribution-parsing.md   # Parse Attribution lines
├── 1-2-section-parsing.md       # Parse Markdown sections
├── 1-3-validation.md            # Validate attributions
├── 1-4-breakdown-generator.md   # Generate breakdown markdown
├── 1-5-attribution-tests.md     # Unit tests for attribution module
├── 2-0-prompt-source-ids.md     # Modify source headings in prompt
├── 2-1-prompt-inject-rules.md   # Inject Source ID Map and Rules
├── 2-2-prompt-tests.md          # Tests for prompt changes
├── 3-0-repair-usecase.md        # Create repair helper
├── 3-1-post-processing.md       # Add post-processing to runSynthesis
├── 3-2-firestore-field.md       # Add attributionStatus to research
├── 4-0-integration-test.md      # End-to-end verification
└── 4-1-final-verification.md    # CI and coverage verification
```

## Issue Numbering

Format: `[tier]-[sequence]-[title].md`

- **Tier 1**: Independent deliverables (attribution module in common-core)
- **Tier 2**: Prompt modifications (synthesisPrompt.ts changes)
- **Tier 3**: ResearchAgent integration (runSynthesis.ts changes)
- **Tier 4**: Verification and cleanup

## Execution Process

1. Execute tasks in tier order (1 → 2 → 3 → 4)
2. Within a tier, execute in sequence order (except 1-x can run in parallel)
3. After each task: update CONTINUITY.md (Done/Now/Next)
4. Run `npm run ci` after each significant change
5. If CI fails: fix before proceeding

## Resume Procedure

1. Read CONTINUITY.md to find current state
2. Continue from "Now" task
3. Update ledger after each step

## Key Files

| File                                                                 | Purpose                        |
| -------------------------------------------------------------------- | ------------------------------ |
| `packages/common-core/src/prompts/synthesisPrompt.ts`                | Prompt builder to modify       |
| `packages/common-core/src/prompts/index.ts`                          | Re-exports for new module      |
| `apps/research-agent/src/domain/research/usecases/runSynthesis.ts` | Central researchAgent           |
| `apps/research-agent/src/infra/llm/GeminiAdapter.ts`               | Synthesizer (for repair calls) |

## Definition of Done

- [ ] Attribution module created with full test coverage
- [ ] Synthesis prompt includes Source ID Map and Attribution Rules
- [ ] Post-processing validates, repairs (once), and appends breakdown
- [ ] `attributionStatus` field added to research Firestore record
- [ ] Multi-digit IDs supported (`S10`, `U12`)
- [ ] `npm run ci` passes with 95% coverage
- [ ] No breaking API changes
