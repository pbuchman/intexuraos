import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyCompletion } from '../services/completion-verifier.js';
import type { CompletionAgentType } from '../services/completion-verifier/schemas.js';

const FIXTURE_ROOT = join(__dirname, 'fixtures/completion-verifier');

interface FixtureDescriptor {
  agentType: CompletionAgentType;
  workerType: string;
  taskId: string;
  txtPath: string;
  expectedPath: string;
}

/**
 * Enumerate every real-production AGENT_FINAL fixture (and its golden
 * .expected.json sibling). Mirrors the helper in block-parser.test.ts —
 * reimplemented here rather than exported to keep the parser test file's
 * surface unchanged, and because only these two files consume it.
 */
function discoverFixtures(): FixtureDescriptor[] {
  const out: FixtureDescriptor[] = [];
  const agentTypes: readonly CompletionAgentType[] = [
    'execution',
    'planning',
    'review',
    'remediation',
    'pull_request',
  ];
  for (const agentType of agentTypes) {
    const agentDir = join(FIXTURE_ROOT, agentType);
    if (!existsSync(agentDir)) continue;
    for (const workerType of readdirSync(agentDir)) {
      const workerDir = join(agentDir, workerType);
      for (const file of readdirSync(workerDir)) {
        if (!file.endsWith('.txt')) continue;
        // Skip negative fixtures — the parser test covers those directly.
        if (file.endsWith('.negative.txt')) continue;
        const taskId = file.replace(/\.txt$/, '');
        out.push({
          agentType,
          workerType,
          taskId,
          txtPath: join(workerDir, file),
          expectedPath: join(workerDir, `${taskId}.expected.json`),
        });
      }
    }
  }
  return out;
}

describe('verifyCompletion — synchronous pipeline', () => {
  it('regression — task_5946dce4 (INT-1441) accepts with populated memory arrays', () => {
    // Phase-5 regression guard. The original failing transcript would have
    // been rejected by the old LLM verifier ("Missing fields: memory_ids_used,
    // memory_ids_rejected") because the agent emitted the deprecated
    // `execution_memory_*` key names. The new deterministic parser resolves
    // the alias and returns the populated arrays. This test would have failed
    // before the INT-1470 refactor and would have caught the regression
    // pre-merge if it had existed when PR #1928 landed.
    const transcript = readFileSync(
      join(FIXTURE_ROOT, 'execution/opus/task_5946dce4-b1b6-46b2-9576-10f316bfdbd4.txt'),
      'utf8'
    );
    const verdict = verifyCompletion({
      transcript,
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: {
        status: 'matched',
        matchedMemories: [
          { memoryId: 'mem_e5089b28-f805-49cb-a2e5-eb4aeb5e932b' } as never,
          { memoryId: 'mem_9e4de081-6568-465e-8a98-6492041bfa7c' } as never,
          { memoryId: 'mem_bd838570-5194-4f6f-ae63-b676b0f7dba9' } as never,
        ],
      } as never,
      lastExitCode: 0,
    });
    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual([]);
    // The agent reported two used and one rejected memory ID — assert the
    // exact ids, not just `.length > 0`. That's the whole point of the
    // fixture: the deprecated-alias rename preserves payload fidelity.
    expect(verdict.data['memory_ids_used']).toEqual([
      'mem_e5089b28-f805-49cb-a2e5-eb4aeb5e932b',
      'mem_bd838570-5194-4f6f-ae63-b676b0f7dba9',
    ]);
    expect(verdict.data['memory_ids_rejected']).toEqual([
      'mem_9e4de081-6568-465e-8a98-6492041bfa7c',
    ]);
    // telemetryMissing must be empty — agent filled both memory_ids_* fields.
    expect(verdict.telemetryMissing).toEqual([]);
  });

  it('returns kind=hard-error when no AGENT_FINAL block is present', () => {
    const verdict = verifyCompletion({
      transcript: 'some unrelated transcript with no marker at all',
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });
    expect(verdict.kind).toBe('hard-error');
    if (verdict.kind !== 'hard-error') return;
    expect(verdict.code).toBe('TASK_RUNTIME_HARD_ERROR');
    expect(verdict.message).toMatch(/No EXECUTION_AGENT_FINAL: block/);
  });

  it('returns kind=hard-error for fatal exit code 137 (SIGKILL)', () => {
    const verdict = verifyCompletion({
      transcript:
        'EXECUTION_AGENT_FINAL:\n- Outcome: implemented\n- pr: https://x/y/1\n- summary: ok',
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 137,
    });
    expect(verdict.kind).toBe('hard-error');
    if (verdict.kind !== 'hard-error') return;
    expect(verdict.code).toBe('TASK_RUNTIME_HARD_ERROR');
    expect(verdict.message).toContain('137');
  });

  it('returns kind=hard-error for fatal exit code 139 (SIGSEGV)', () => {
    const verdict = verifyCompletion({
      transcript: 'anything',
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 139,
    });
    expect(verdict.kind).toBe('hard-error');
  });

  it('is synchronous (returns a plain object, not a Promise)', () => {
    const result = verifyCompletion({
      transcript: 'no block',
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('accepts ask_agent trivially (no contract to enforce)', () => {
    const verdict = verifyCompletion({
      transcript: 'no block, no matter — ask_agent has no contract',
      agentType: 'ask_agent',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });
    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual([]);
  });

  it('flags telemetryMissing when memories injected but neither field populated', () => {
    const transcript = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- pr: https://github.com/x/y/pull/1',
      '- summary: ok',
      '- memory_ids_used: none',
      '- memory_ids_rejected: none',
    ].join('\n');
    const verdict = verifyCompletion({
      transcript,
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: {
        status: 'matched',
        matchedMemories: [{ memoryId: 'mem_a' } as never],
      } as never,
      lastExitCode: 0,
    });
    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.telemetryMissing).toEqual(['memory_ids_used', 'memory_ids_rejected']);
  });
});

describe('verifyCompletion — full-fixture replay (Phase-5 regression guard)', () => {
  // Every real-production AGENT_FINAL transcript harvested into the fixture
  // corpus MUST either accept (kind='parsed' with missingRequired=[]) when
  // the golden says the block is a deliverable, or cleanly report the same
  // missingRequired set the parser captured in the golden. The one thing
  // that may NEVER happen on a real transcript that contains the marker is
  // `kind='hard-error'` — that verdict is reserved for transcripts with no
  // marker at all (see the `returns kind=hard-error when no AGENT_FINAL
  // block is present` test above and the dedicated negative fixtures in
  // block-parser.test.ts).
  const fixtures = discoverFixtures();

  it('discovers at least 100 fixtures (sanity)', () => {
    expect(fixtures.length).toBeGreaterThan(100);
  });

  interface Golden {
    missingRequired: string[];
  }

  it.each(fixtures)(
    '$agentType/$workerType/$taskId replays through verifyCompletion without hard-error',
    ({ agentType, workerType, txtPath, expectedPath }) => {
      const transcript = readFileSync(txtPath, 'utf8');
      const golden = JSON.parse(readFileSync(expectedPath, 'utf8')) as Golden;
      const verdict = verifyCompletion({
        transcript,
        agentType,
        // Worker type is only used for tier lookup downstream; the parser
        // itself is worker-agnostic. Pass the fixture's bucket through as-is.
        workerType: workerType as never,
        // No memory context injected — we're exercising the parser, not the
        // telemetry policy. The golden files capture the parser output, which
        // is independent of executionMemoryContext.
        executionMemoryContext: undefined,
        lastExitCode: 0,
      });
      expect(
        verdict.kind,
        `fixture ${txtPath} must not produce a hard-error — that verdict is reserved for transcripts with no AGENT_FINAL marker`
      ).toBe('parsed');
      if (verdict.kind !== 'parsed') return;
      // missingRequired must match the golden exactly. Deliverable fixtures
      // (golden has []) must verify cleanly; incomplete-deliverable fixtures
      // (golden has a non-empty list) must still be `parsed`, never
      // `hard-error`, and must report the same missing set.
      expect(verdict.missingRequired).toEqual(golden.missingRequired);
    }
  );
});
