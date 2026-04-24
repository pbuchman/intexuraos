import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyCompletion } from '../services/completion-verifier.js';

const FIXTURE_ROOT = join(__dirname, 'fixtures/completion-verifier');

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
