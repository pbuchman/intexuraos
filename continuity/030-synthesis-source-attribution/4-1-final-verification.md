# 4-1: Final Verification

**Tier:** 4 (Verification)

## Context Snapshot

Run full CI verification and confirm all acceptance criteria are met.

## Codebase Rules

Read `.claude/CLAUDE.md`:
- `npm run ci` MUST pass before task completion
- 95% coverage required
- Never modify coverage thresholds

## Dependencies

- **Requires:** All previous tasks complete

## Problem Statement

Final verification that:
1. All tests pass
2. Coverage thresholds met
3. Linting passes
4. Type checking passes
5. All acceptance criteria satisfied

## Verification Steps

### Step 1: Run Full CI

```bash
npm run ci
```

This must pass. If it fails, fix issues before proceeding.

### Step 2: Verify Attribution Module Exports

```bash
# Check that attribution module is exported from common-core
grep -r "attribution" packages/common-core/src/prompts/index.ts
grep -r "attribution" packages/common-core/src/index.ts
```

Expected: Export statements for attribution types and functions.

### Step 3: Verify Prompt Changes

```bash
# Run synthesis prompt tests
npm run test -- packages/common-core/src/prompts/__tests__/synthesisPrompt.test.ts
```

Verify output shows tests for:
- S#/U# heading format
- Source ID Map presence
- Attribution Rules presence
- "DO NOT output" instruction

### Step 4: Verify Orchestrator Integration

```bash
# Run orchestrator tests
npm run test -- apps/llm-orchestrator/src/domain/research/usecases/
```

Verify tests for:
- Attribution validation
- Repair flow
- Breakdown generation
- attributionStatus field

### Step 5: Check Coverage Report

```bash
npm run test -- --coverage
```

Verify:
- `packages/common-core/src/prompts/attribution.ts` ≥95%
- `apps/llm-orchestrator/src/domain/research/usecases/repairAttribution.ts` ≥95%
- Overall coverage maintained

### Step 6: Manual Smoke Test (Optional)

If possible, run a local synthesis and verify:
1. Output contains Attribution lines
2. Breakdown section appended
3. attributionStatus field in Firestore

## Acceptance Criteria Checklist

- [ ] Attribution module created with full test coverage
- [ ] `parseAttributionLine` handles multi-digit IDs
- [ ] `parseSections` supports ## → ### → implicit fallback
- [ ] `validateSynthesisAttributions` catches all error types
- [ ] `generateBreakdown` excludes constraints from score
- [ ] Synthesis prompt includes Source ID Map (not ## heading)
- [ ] Synthesis prompt includes Attribution Rules
- [ ] Synthesis prompt includes "DO NOT output breakdown" instruction
- [ ] Source headings use S#/U# format
- [ ] Post-processing validates → repairs → appends breakdown
- [ ] `attributionStatus` field added to Research model
- [ ] `npm run ci` passes
- [ ] Coverage ≥95% maintained

## Step Checklist

- [ ] Run `npm run ci` — must pass
- [ ] Verify attribution module exports
- [ ] Verify prompt test output
- [ ] Verify orchestrator test output
- [ ] Check coverage report
- [ ] Verify all acceptance criteria

## Definition of Done

- `npm run ci` passes
- All acceptance criteria met
- Ready for PR/deployment

## Verification Commands

```bash
npm run ci
npm run test -- --coverage
```

## Rollback Plan

If final verification fails, identify failing task and fix. Do not skip verification.

## Non-Negotiable Quality Bar

- `npm run ci` MUST pass (no exceptions)
- 95% coverage MUST be maintained
- ALL acceptance criteria checked off
- No skipped tests

## Post-Completion

After verification passes:

1. Update CONTINUITY.md — mark all tasks Done
2. Move directory to `continuity/archive/030-synthesis-source-attribution/`
3. Consider creating PR

```bash
# Archive command
mv continuity/030-synthesis-source-attribution continuity/archive/
```
