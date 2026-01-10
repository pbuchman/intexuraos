# 4-0: Integration Test

**Tier:** 4 (Verification)

## Context Snapshot

Create integration tests for the full attribution flow in research-agent.

## Codebase Rules

Read `.claude/CLAUDE.md`:

- 95% coverage required
- No external deps in tests (use fakes, nock for HTTP)
- Pattern: `setServices({fakes})` in `beforeEach`, `resetServices()` in `afterEach`
- Routes tested via `app.inject()`

## Dependencies

- **Requires:** All Tier 3 tasks complete

## Problem Statement

Test the end-to-end attribution flow:

1. Synthesis with valid attributions → status complete
2. Synthesis with missing attributions → repair attempt → status repaired/incomplete
3. Breakdown appended correctly

## Files to Create/Modify

| File                                                                                   | Action                   |
| -------------------------------------------------------------------------------------- | ------------------------ |
| `apps/research-agent/src/domain/research/usecases/__tests__/runSynthesis.test.ts`      | **MODIFY** or **CREATE** |
| `apps/research-agent/src/domain/research/usecases/__tests__/repairAttribution.test.ts` | **CREATE**               |

## Files to Read First

1. `apps/research-agent/src/domain/research/usecases/runSynthesis.ts` — the function to test
2. `apps/research-agent/src/domain/research/usecases/repairAttribution.ts` — repair function
3. Existing test files in the same directory for patterns

## Test Cases for repairAttribution

```typescript
describe('repairAttribution', () => {
  it('returns repaired content when synthesizer fixes attributions', async () => {
    const rawContent = `## Overview\n\nContent without attribution.`;
    const sourceMap: SourceMapItem[] = [{ id: 'S1', kind: 'llm', displayName: 'GPT-4' }];

    const mockSynthesizer = {
      synthesize: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          content: `## Overview\n\nContent.\n\nAttribution: Primary=S1; Secondary=; Constraints=; UNK=false`,
        },
      }),
    };

    const result = await repairAttribution(rawContent, sourceMap, {
      synthesizer: mockSynthesizer,
    });

    expect(result.ok).toBe(true);
    expect(result.value).toContain('Attribution:');
  });

  it('returns error when synthesizer fails', async () => {
    const mockSynthesizer = {
      synthesize: vi.fn().mockResolvedValue({
        ok: false,
        error: new Error('LLM error'),
      }),
    };

    const result = await repairAttribution('content', [], { synthesizer: mockSynthesizer });

    expect(result.ok).toBe(false);
  });

  it('returns error when repaired output is still invalid', async () => {
    // Mock returns content that still doesn't validate
  });
});
```

## Test Cases for runSynthesis Attribution Flow

```typescript
describe('runSynthesis attribution flow', () => {
  it('sets attributionStatus to complete when valid', async () => {
    // Mock synthesizer returns content with valid Attribution lines
    // Verify researchRepo.update called with attributionStatus: 'complete'
  });

  it('attempts repair when attributions invalid', async () => {
    // Mock synthesizer returns content without Attribution lines
    // Mock repair call
    // Verify repair was attempted
  });

  it('sets attributionStatus to repaired after successful repair', async () => {
    // Mock synthesizer returns invalid
    // Mock repair returns valid
    // Verify attributionStatus: 'repaired'
  });

  it('sets attributionStatus to incomplete when repair fails', async () => {
    // Mock synthesizer returns invalid
    // Mock repair also returns invalid
    // Verify attributionStatus: 'incomplete'
  });

  it('appends breakdown to synthesizedResult', async () => {
    // Verify final content includes "## Source Utilization Breakdown"
  });
});
```

## Mock Patterns

```typescript
// Mock synthesizer
const mockSynthesizer: LlmSynthesisProvider = {
  synthesize: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      content: `## Overview\n\nTest content.\n\nAttribution: Primary=S1; Secondary=; Constraints=; UNK=false`,
      usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
    },
  }),
};

// Mock research repository
const mockResearchRepo = {
  findById: vi.fn().mockResolvedValue({ ok: true, value: mockResearch }),
  update: vi.fn().mockResolvedValue({ ok: true }),
};
```

## Step Checklist

- [ ] Create repairAttribution.test.ts
- [ ] Add tests for successful repair
- [ ] Add tests for failed repair
- [ ] Add tests for invalid repaired output
- [ ] Modify/create runSynthesis.test.ts
- [ ] Add attribution flow tests
- [ ] Verify breakdown appended
- [ ] Verify attributionStatus values
- [ ] Run `npm run test -- apps/research-agent`
- [ ] Verify coverage

## Definition of Done

- All new functions have test coverage
- Attribution flow tested end-to-end
- `npm run test` passes
- Coverage ≥95% for new code

## Verification Commands

```bash
npm run test -- apps/research-agent/src/domain/research/usecases/
npm run test -- apps/research-agent --coverage
```

## Rollback Plan

Remove new test files.

## Non-Negotiable Quality Bar

- 95% coverage on new code
- Test all three attributionStatus values
- Test breakdown appended even when incomplete
- Use mocks, no real LLM calls
