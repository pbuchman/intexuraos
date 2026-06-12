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

describe('verifyCompletion — real-rawLogs regression (NDJSON-aware fallback)', () => {
  // Fixture captured live from the home-dev orchestrator on 2026-04-25 by
  // instrumenting `task-dispatcher.ts` to dump the exact `rawLogs` string
  // passed to `runVerification`. The agent emitted a perfectly valid
  // PLANNING_AGENT_FINAL block, but inside a Claude SDK `assistant` event's
  // `text` field — i.e. the marker exists only as the JSON-escaped string
  // `"text":"PLANNING_AGENT_FINAL:\\n- ..."` and never appears on its own
  // line in the raw transcript. Before this fix, the production verifier
  // returned `kind:'hard-error'` with `code:TASK_RUNTIME_HARD_ERROR` and
  // finalized the task as `failed` — exactly the INT-1560 Group B mode.
  //
  // The post-fix expectation (encoded in planning-probe-unclear.expected.json)
  // is that the verifier's NDJSON-aware fallback in `locateFinalBlock` finds
  // the block and `verifyCompletion` returns `kind:'parsed'` with the agent's
  // emitted fields surfaced. The probe agent left `linear_issue` and `plan_pr`
  // empty (no Linear issue attached to the synthetic prompt), so those two
  // required fields are reported as `missingRequired` — *the contract is
  // doing its job*. The bug was that the parser couldn't see the block at all.
  const RAW_RAWLOGS_DIR = join(FIXTURE_ROOT, 'raw-rawlogs');
  const probeRawLogs = readFileSync(
    join(RAW_RAWLOGS_DIR, 'planning-probe-unclear.rawlogs.txt'),
    'utf8'
  );
  const probeExpected = JSON.parse(
    readFileSync(join(RAW_RAWLOGS_DIR, 'planning-probe-unclear.expected.json'), 'utf8')
  ) as {
    agentType: CompletionAgentType;
    workerType: string;
    postFixVerdict: {
      kind: 'parsed';
      missingRequired: string[];
      dataAssertions: Record<string, string | boolean | number>;
    };
  };

  it('parses the captured probe rawLogs (NDJSON-buried marker) without hard-error', () => {
    const verdict = verifyCompletion({
      transcript: probeRawLogs,
      agentType: probeExpected.agentType,
      workerType: probeExpected.workerType as never,
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });
    expect(
      verdict.kind,
      'real-rawLogs fixture must NOT produce a hard-error after the NDJSON-aware fallback ships — that is the entire INT-1560 Group B fix'
    ).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual(probeExpected.postFixVerdict.missingRequired);
    // Spot-check the parsed fields surfaced from the assistant text content.
    expect(verdict.data['outcome']).toBe(probeExpected.postFixVerdict.dataAssertions['outcome']);
    expect(verdict.data['superpowers_writing_plans_used']).toBe(
      probeExpected.postFixVerdict.dataAssertions['superpowers_writing_plans_used']
    );
    expect(verdict.data['complex_task']).toBe(
      probeExpected.postFixVerdict.dataAssertions['complex_task']
    );
    expect(verdict.data['plan_doc']).toBe(probeExpected.postFixVerdict.dataAssertions['plan_doc']);
    expect(String(verdict.data['clarification_message'])).toContain(
      String(probeExpected.postFixVerdict.dataAssertions['clarification_messageContains'])
    );
    expect(String(verdict.data['summary'])).toContain(
      String(probeExpected.postFixVerdict.dataAssertions['summaryContains'])
    );
  });

  it('regression document: confirms the marker is NOT on its own line in the raw transcript', () => {
    // This is a documenting test, not a behavioural one. It captures the
    // mechanism of the bug — if a future change accidentally normalises the
    // raw transcript before it reaches the verifier, this test will fail and
    // alert the reviewer to update the fixture or remove the documentation.
    const rfc3339Stripped = probeRawLogs.replace(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /gm,
      ''
    );
    const ownLineMarkerRegex = /^\s*PLANNING_AGENT_FINAL:\s*$/m;
    expect(
      ownLineMarkerRegex.test(rfc3339Stripped),
      'real production rawLogs must keep the AGENT_FINAL marker buried inside NDJSON; if this assertion ever fires, the fixture or the upstream pipeline changed'
    ).toBe(false);
    expect(rfc3339Stripped).toContain('PLANNING_AGENT_FINAL'); // substring is present
  });
});

describe('verifyCompletion — codex exec --json regression', () => {
  // Fixture captured live on 2026-04-27 by running
  //   docker exec <preserved-container> codex exec --json --skip-git-repo-check \
  //     --dangerously-bypass-approvals-and-sandbox -
  // against codex-cli 0.125.0 (the version baked into the production code-worker
  // image), with a tiny prompt asking codex to emit a fixed PULL_REQUEST_AGENT_FINAL
  // block. The thread_id was sanitized to all-zeros; everything else is real
  // codex stdout, including the trailing `codex_core::session: failed to record
  // rollout items` stderr line that codex emits after every turn.
  //
  // This is the exact byte shape the verifier consumes via `getWorkerLogs()`
  // when the orchestrator dispatches a codex worker. Before the codex extractor
  // shipped in `ndjson-extractor.ts`, the marker was buried inside
  //   {"type":"item.completed","item":{"type":"agent_message","text":"...\\n..."}}
  // — a shape the INT-1560 Claude-SDK fallback did not recognize — so the
  // verifier returned hard-error and the orchestrator finalized the task as
  // `failed` even though codex completed cleanly. Real production failure that
  // motivated this fixture: task_70a75a13-b0fd-4607-aec6-7d1a375af9be.
  const RAW_RAWLOGS_DIR = join(FIXTURE_ROOT, 'raw-rawlogs');
  const codexRawLogs = readFileSync(
    join(RAW_RAWLOGS_DIR, 'codex-pull-request-final.rawlogs.txt'),
    'utf8'
  );
  const codexExpected = JSON.parse(
    readFileSync(join(RAW_RAWLOGS_DIR, 'codex-pull-request-final.expected.json'), 'utf8')
  ) as {
    agentType: CompletionAgentType;
    workerType: string;
    postFixVerdict: {
      kind: 'parsed';
      missingRequired: string[];
      dataAssertions: Record<string, string | number | boolean>;
    };
  };

  it('parses real codex exec --json stdout without hard-error', () => {
    const verdict = verifyCompletion({
      transcript: codexRawLogs,
      agentType: codexExpected.agentType,
      workerType: codexExpected.workerType as never,
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });
    expect(
      verdict.kind,
      'real codex stdout fixture MUST NOT produce a hard-error after the codex extractor ships — that is the entire fix'
    ).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual(codexExpected.postFixVerdict.missingRequired);
    const a = codexExpected.postFixVerdict.dataAssertions;
    expect(verdict.data['pr']).toBe(a['pr']);
    expect(verdict.data['comment_replied']).toBe(a['comment_replied']);
    expect(verdict.data['tracking_comment_id']).toBe(a['tracking_comment_id']);
    expect(verdict.data['tracking_comment']).toBe(a['tracking_comment']);
    expect(verdict.data['total_pr_comments_posted']).toBe(a['total_pr_comments_posted']);
    expect(String(verdict.data['ci_evidence'])).toContain(String(a['ci_evidenceContains']));
    expect(String(verdict.data['summary'])).toContain(String(a['summaryContains']));
  });

  it('regression document: confirms the marker is NOT on its own line in raw codex stdout', () => {
    // The marker exists ONLY as the JSON-escaped text inside an
    // item.completed/agent_message envelope. If a future change starts
    // emitting the marker on its own line in the raw bytes, this assertion
    // will fire and remind the reviewer to refresh the fixture.
    const ownLineMarkerRegex = /^\s*PULL_REQUEST_AGENT_FINAL:\s*$/m;
    expect(
      ownLineMarkerRegex.test(codexRawLogs),
      'codex stdout must keep the marker buried inside the item.completed JSON envelope'
    ).toBe(false);
    expect(codexRawLogs).toContain('PULL_REQUEST_AGENT_FINAL');
    expect(codexRawLogs).toContain('"type":"item.completed"');
    expect(codexRawLogs).toContain('"type":"agent_message"');
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
