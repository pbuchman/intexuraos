# 2-1: Inject Source ID Map and Attribution Rules

**Tier:** 2 (Dependent Deliverable)

## Context Snapshot

Inject the Source ID Map and Attribution Rules sections into the synthesis prompt.

## Codebase Rules

Read `.claude/CLAUDE.md`:
- Backward compatibility required
- Both legacy and contextual paths need updates

## Dependencies

- **Requires:** 2-0-prompt-source-ids.md completed

## Problem Statement

Add two new sections to the synthesis prompt:

1. **Source ID Map** — tells the LLM which IDs map to which sources
2. **Attribution Rules** — tells the LLM how to format Attribution lines

**CRITICAL:** These sections must NOT use `##` headings. Use plain text labels to avoid parser confusion if the model echoes prompt sections.

## Files to Modify

| File | Action |
|------|--------|
| `packages/common-core/src/prompts/synthesisPrompt.ts` | **MODIFY** |

## Files to Read First

1. `packages/common-core/src/prompts/synthesisPrompt.ts` — current structure

## New Helper Function

Add this helper function:

```typescript
function buildSourceIdMapSection(
  reports: ReadonlyArray<{ model: string }>,
  additionalSources?: ReadonlyArray<{ label?: string }>
): string {
  const lines: string[] = [
    'SOURCE ID MAP (for Attribution)',
    '',
    '| ID | Type | Name |',
    '|----|------|------|',
  ];

  reports.forEach((r, idx) => {
    lines.push(`| S${idx + 1} | LLM | ${r.model} |`);
  });

  if (additionalSources !== undefined) {
    additionalSources.forEach((s, idx) => {
      const label = s.label ?? `Source ${idx + 1}`;
      lines.push(`| U${idx + 1} | User | ${label} |`);
    });
  }

  return lines.join('\n');
}
```

## Attribution Rules Section

Add this as a constant:

```typescript
const ATTRIBUTION_RULES = `ATTRIBUTION RULES

For each ## section in your synthesis, end with an Attribution line:

    Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false

- **Primary**: Sources providing main content for this section
- **Secondary**: Sources providing supporting/supplementary info
- **Constraints**: Sources providing limitations, caveats, or warnings
- **UNK**: Set to true ONLY if genuinely uncertain about attribution

Rules:
- Use ONLY IDs from the Source ID Map above (S1, S2, U1, etc.)
- Empty lists are valid: Constraints=;
- Separate multiple IDs with commas: Primary=S1,S2
- DO NOT include model names in the Attribution line
- DO NOT output a "Source Utilization Breakdown" section (system appends it)`;
```

## Injection Points

### In buildContextualSynthesisPrompt

Insert after "## Sources Used" section (around line 146):

```typescript
${buildSourceIdMapSection(reports, additionalSources)}

${ATTRIBUTION_RULES}
```

### In legacy path

Insert after "## Sources Used" section (around line 269):

```typescript
${buildSourceIdMapSection(reports, legacyAdditionalSources)}

${ATTRIBUTION_RULES}
```

### Add to "Your Task" section

In both paths, add to the task list:
```
6. **Attribute sources**: End each ## section with an Attribution line (see Attribution Rules)
```

## Step Checklist

- [ ] Add `buildSourceIdMapSection` helper function
- [ ] Add `ATTRIBUTION_RULES` constant
- [ ] Inject both sections in buildContextualSynthesisPrompt
- [ ] Inject both sections in legacy path
- [ ] Add attribution task to "Your Task" list (both paths)
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`

## Definition of Done

- Source ID Map section added to prompt
- Attribution Rules section added to prompt
- "Your Task" includes attribution instruction
- Both paths updated
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

Remove the helper function, constant, and injected sections.

## Non-Negotiable Quality Bar

- Injected sections MUST NOT use `##` headings
- MUST include "DO NOT output a Source Utilization Breakdown" instruction
- MUST mention that IDs should come from Source ID Map only
- Both contextual AND legacy paths must be updated
