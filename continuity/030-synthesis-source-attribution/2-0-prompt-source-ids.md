# 2-0: Modify Source Headings in Prompt

**Tier:** 2 (Dependent Deliverable)

## Context Snapshot

Change source headings in the synthesis prompt to use neutral IDs (S1, S2, U1, U2) instead of model names directly.

## Codebase Rules

Read `.claude/CLAUDE.md`:

- Backward compatibility required (no signature changes)
- Both legacy and contextual paths need updates

## Dependencies

- **Requires:** Tier 1 complete (attribution module exists)

## Problem Statement

Currently, source headings look like:

```markdown
### GPT-4

<content>

### Claude

<content>
```

Change to:

```markdown
### S1 (LLM report; model: GPT-4)

<content>

### S2 (LLM report; model: Claude)

<content>
```

And for additional sources:

```markdown
### U1 (Additional source; label: Wikipedia)

<content>
```

## Files to Modify

| File                                                  | Action     |
| ----------------------------------------------------- | ---------- |
| `packages/common-core/src/prompts/synthesisPrompt.ts` | **MODIFY** |

## Files to Read First

1. `packages/common-core/src/prompts/synthesisPrompt.ts` — full file, understand both paths
2. `packages/common-core/src/prompts/__tests__/synthesisPrompt.test.ts` — existing tests

## Exact Changes

### In `buildContextualSynthesisPrompt` (line ~81)

**Before:**

```typescript
const formattedReports = reports.map((r) => `### ${r.model}\n\n${r.content}`).join('\n\n---\n\n');
```

**After:**

```typescript
const formattedReports = reports
  .map((r, idx) => `### S${idx + 1} (LLM report; model: ${r.model})\n\n${r.content}`)
  .join('\n\n---\n\n');
```

### In `buildContextualSynthesisPrompt` (lines ~86-88)

**Before:**

```typescript
const sourceLabel = source.label ?? `Source ${String(idx + 1)}`;
return `### ${sourceLabel}\n\n${source.content}`;
```

**After:**

```typescript
const sourceLabel = source.label ?? `Source ${String(idx + 1)}`;
return `### U${idx + 1} (Additional source; label: ${sourceLabel})\n\n${source.content}`;
```

### In legacy path (line ~216)

**Before:**

```typescript
const formattedReports = reports.map((r) => `### ${r.model}\n\n${r.content}`).join('\n\n---\n\n');
```

**After:**

```typescript
const formattedReports = reports
  .map((r, idx) => `### S${idx + 1} (LLM report; model: ${r.model})\n\n${r.content}`)
  .join('\n\n---\n\n');
```

### In legacy path (lines ~221-223)

**Before:**

```typescript
const sourceLabel = source.label ?? `Source ${String(idx + 1)}`;
return `### ${sourceLabel}\n\n${source.content}`;
```

**After:**

```typescript
const sourceLabel = source.label ?? `Source ${String(idx + 1)}`;
return `### U${idx + 1} (Additional source; label: ${sourceLabel})\n\n${source.content}`;
```

## Step Checklist

- [ ] Update formattedReports in buildContextualSynthesisPrompt
- [ ] Update additionalSources formatting in buildContextualSynthesisPrompt
- [ ] Update formattedReports in legacy path
- [ ] Update additionalSources formatting in legacy path
- [ ] Run `npm run typecheck`
- [ ] Run `npm run test -- packages/common-core`

## Definition of Done

- All source headings use `S#`/`U#` format
- Both contextual and legacy paths updated
- `npm run test` passes (some tests may need updates in 2-2)

## Verification Commands

```bash
npm run typecheck
npm run test -- packages/common-core/src/prompts/__tests__/synthesisPrompt.test.ts
```

## Rollback Plan

Revert the 4 changes to synthesisPrompt.ts.

## Non-Negotiable Quality Bar

- Both paths MUST be updated (don't forget legacy)
- Format MUST be `### S# (LLM report; model: <name>)` exactly
- Index starts at 1, not 0
- No signature changes to `buildSynthesisPrompt`
