# 2-2: Prompt Tests Update

**Tier:** 2 (Dependent Deliverable)

## Context Snapshot

Update existing prompt tests and add new tests for Source ID Map and Attribution Rules.

## Codebase Rules

Read `.claude/CLAUDE.md`:
- 95% coverage required
- Use `.toContain()` for string validation
- Factory functions for test data

## Dependencies

- **Requires:** 2-0-prompt-source-ids.md completed
- **Requires:** 2-1-prompt-inject-rules.md completed

## Problem Statement

Update tests to verify:
1. Source headings use S#/U# format
2. Source ID Map section is present (not as `##` heading)
3. Attribution Rules section is present
4. "DO NOT output" instruction is present

## Files to Modify

| File | Action |
|------|--------|
| `packages/common-core/src/prompts/__tests__/synthesisPrompt.test.ts` | **MODIFY** |

## Files to Read First

1. `packages/common-core/src/prompts/__tests__/synthesisPrompt.test.ts` — existing tests
2. `packages/common-core/src/prompts/synthesisPrompt.ts` — updated prompt

## Tests to Add/Update

### Update Existing Tests

Some existing tests may check for `### GPT-4` format. Update them to expect `### S1 (LLM report; model: GPT-4)`.

### New Tests to Add

```typescript
describe('buildSynthesisPrompt', () => {
  describe('source attribution', () => {
    it('formats LLM report headings with S# IDs', () => {
      const reports: SynthesisReport[] = [
        { model: 'GPT-4', content: 'Content 1' },
        { model: 'Claude', content: 'Content 2' },
      ];
      const result = buildSynthesisPrompt('Test prompt', reports);

      expect(result).toContain('### S1 (LLM report; model: GPT-4)');
      expect(result).toContain('### S2 (LLM report; model: Claude)');
    });

    it('formats additional source headings with U# IDs', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const additionalSources: AdditionalSource[] = [
        { label: 'Wikipedia', content: 'Wiki content' },
      ];
      const result = buildSynthesisPrompt('Test prompt', reports, additionalSources);

      expect(result).toContain('### U1 (Additional source; label: Wikipedia)');
    });

    it('includes Source ID Map section', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const result = buildSynthesisPrompt('Test prompt', reports);

      expect(result).toContain('SOURCE ID MAP');
      expect(result).toContain('| S1 | LLM | GPT-4 |');
    });

    it('does not use ## heading for Source ID Map', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const result = buildSynthesisPrompt('Test prompt', reports);

      expect(result).not.toContain('## SOURCE ID MAP');
    });

    it('includes Attribution Rules section', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const result = buildSynthesisPrompt('Test prompt', reports);

      expect(result).toContain('ATTRIBUTION RULES');
      expect(result).toContain('Primary=');
      expect(result).toContain('Secondary=');
      expect(result).toContain('Constraints=');
    });

    it('instructs not to output breakdown', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const result = buildSynthesisPrompt('Test prompt', reports);

      expect(result).toContain('DO NOT output');
      expect(result).toContain('Source Utilization Breakdown');
    });

    it('includes attribution task in Your Task section', () => {
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const result = buildSynthesisPrompt('Test prompt', reports);

      expect(result).toContain('Attribute sources');
      expect(result).toContain('Attribution line');
    });
  });

  describe('with SynthesisContext', () => {
    it('includes Source ID Map in contextual prompt', () => {
      const ctx = createTestSynthesisContext();
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const result = buildSynthesisPrompt('Test prompt', reports, ctx);

      expect(result).toContain('SOURCE ID MAP');
    });

    it('includes Attribution Rules in contextual prompt', () => {
      const ctx = createTestSynthesisContext();
      const reports: SynthesisReport[] = [{ model: 'GPT-4', content: 'Content' }];
      const result = buildSynthesisPrompt('Test prompt', reports, ctx);

      expect(result).toContain('ATTRIBUTION RULES');
    });
  });
});
```

## Step Checklist

- [ ] Review existing tests for format changes needed
- [ ] Update any tests that expect old heading format
- [ ] Add S#/U# heading format tests
- [ ] Add Source ID Map presence tests
- [ ] Add Attribution Rules presence tests
- [ ] Add "DO NOT output" instruction test
- [ ] Add contextual path tests
- [ ] Run `npm run test -- packages/common-core`
- [ ] Verify coverage

## Definition of Done

- All existing tests pass (with updates)
- New tests for attribution features added
- Coverage ≥95%
- `npm run test` passes

## Verification Commands

```bash
npm run test -- packages/common-core/src/prompts/__tests__/synthesisPrompt.test.ts
npm run test -- packages/common-core --coverage
```

## Rollback Plan

Revert test file changes.

## Non-Negotiable Quality Bar

- Must test BOTH legacy and contextual paths
- Must verify injected sections are NOT `##` headings
- Must verify "DO NOT output" instruction is present
- 95% coverage maintained
