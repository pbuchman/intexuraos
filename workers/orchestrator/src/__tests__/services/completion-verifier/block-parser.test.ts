import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  locateFinalBlock,
  parseKeyValues,
  coerceFields,
} from '../../../services/completion-verifier/block-parser.js';
import { verifyCompletion } from '../../../services/completion-verifier.js';
import { AGENT_CONTRACTS } from '../../../services/completion-verifier/contracts.js';
import type { AgentContract } from '../../../services/completion-verifier/contracts.js';

const FIXTURE_ROOT = join(__dirname, '../../fixtures/completion-verifier');

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURE_ROOT, relPath), 'utf8');
}

describe('locateFinalBlock', () => {
  it('finds EXECUTION_AGENT_FINAL in the clean opus fixture', () => {
    const txt = readFixture('execution/opus/task_46355056-c73e-49a6-9778-4cb71366dcf5.txt');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: implemented');
  });

  it('finds the marker despite trailing markdown emphasis (minimax)', () => {
    const txt = readFixture('execution/minimax/task_24eb987c-361e-4973-90a8-229e7432b645.txt');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome:');
  });

  it('finds the marker despite trailing backtick (review/sonnet)', () => {
    const txt = readFixture('review/sonnet/task_7c90204e-72fa-4975-bbd1-20376b0c592e.txt');
    const block = locateFinalBlock(txt, 'REVIEW_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- review_id:');
  });

  it('rejects false-positive marker buried in a diff line (task_536a87b7)', () => {
    const txt = readFixture(
      'execution/opus/task_536a87b7-6565-4442-a446-392c33223bb0.negative.txt'
    );
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    // Fixture captures a line containing `PULL_REQUEST_AGENT_FINAL:` inside a
    // test-file diff — it's not a real emitted block. Parser must reject.
    expect(block).toBeNull();
  });

  it('returns null when marker is absent', () => {
    expect(locateFinalBlock('no agent block here\nmore text', 'EXECUTION_AGENT_FINAL:')).toBeNull();
  });

  it('takes the LAST marker when multiple exist (agents sometimes draft one before finalizing)', () => {
    const txt = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: failed',
      '- summary: first draft',
      '',
      'wait, trying again',
      '',
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- pr: https://github.com/x/y/pull/1',
      '- summary: final version',
    ].join('\n');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: implemented');
    expect(block).not.toContain('first draft');
  });

  it('strips log-driver prefix like "[claude] " from the marker detection', () => {
    const txt =
      '[claude] EXECUTION_AGENT_FINAL:\n[claude] - Outcome: implemented\n[claude] - summary: ok';
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: implemented');
  });

  it('terminates the body at a closing code fence (```)', () => {
    // [INT-1470 coverage] Exercise the code-fence end-of-block detector in
    // locateFinalBlock. Agents sometimes wrap the AGENT_FINAL block in a
    // fenced section; anything after the closing ``` must NOT bleed into
    // the body.
    const txt = [
      '```',
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- pr: https://github.com/x/y/pull/1',
      '- summary: ok',
      '```',
      'trailing prose that must be excluded',
    ].join('\n');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: implemented');
    expect(block).not.toContain('trailing prose');
  });

  it('does NOT terminate the body on a fake/unknown AGENT_FINAL-looking marker', () => {
    // [INT-1470 review follow-up] The end-of-block detector only recognises
    // markers registered in AGENT_CONTRACTS. A typo/fake marker like
    // `FAKE_AGENT_FINAL:` quoted inside a real block must NOT cut the body
    // short — the summary below must survive.
    const txt = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- pr: https://github.com/x/y/pull/1',
      '- summary: the reviewer mentioned FAKE_AGENT_FINAL: as an example of a fake marker',
      'FAKE_AGENT_FINAL:',
      '- still part of the body',
    ].join('\n');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    // Body contains the entire transcript from EXECUTION_AGENT_FINAL onwards,
    // including the fake marker line and what follows it.
    expect(block).toContain('FAKE_AGENT_FINAL:');
    expect(block).toContain('still part of the body');
  });

  it('terminates the body when a different AGENT_FINAL marker starts', () => {
    // [INT-1470 coverage] If the transcript contains a PULL_REQUEST_AGENT_FINAL
    // block immediately after an EXECUTION_AGENT_FINAL block, the body of
    // the first must stop where the second begins — not bleed through.
    const txt = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- pr: https://github.com/x/y/pull/1',
      '- summary: ok',
      'PULL_REQUEST_AGENT_FINAL:',
      '- pr_url: https://github.com/x/y/pull/2',
    ].join('\n');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: implemented');
    expect(block).not.toContain('PULL_REQUEST_AGENT_FINAL');
    expect(block).not.toContain('pr_url');
  });

  // INT-1560 fix: NDJSON-aware fallback. The deployed worker invokes Claude
  // with `--print --verbose --output-format stream-json`, so the agent's
  // emitted text lives only inside `{"type":"assistant","message":{"content":
  // [{"type":"text","text":"PLANNING_AGENT_FINAL:\\n..."}]}}` events. After
  // `stripDockerHeaders`, the marker is still buried in the JSON-escaped
  // string and never appears on its own line. The fallback path parses each
  // JSON event and substitutes its `text`/`result` field content with real
  // newlines so the locator can find the block.
  it('finds the marker via NDJSON fallback when buried in an assistant text event', () => {
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'PLANNING_AGENT_FINAL:\n- Outcome: planned\n- Summary: ok',
          },
        ],
      },
    });
    const block = locateFinalBlock(event, 'PLANNING_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: planned');
  });

  it('finds the marker via NDJSON fallback when only present in a result event', () => {
    const event = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'EXECUTION_AGENT_FINAL:\n- Outcome: implemented\n- pr: https://x/y/1\n- summary: ok',
    });
    const block = locateFinalBlock(event, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: implemented');
  });

  it('NDJSON fallback ignores tool_use blocks even when input mentions the marker substring', () => {
    // A tool_use block whose JSON-input happens to mention the marker as
    // a literal string (e.g. an Edit on a doc that quotes the prompt) must
    // not be mistaken for an agent-emitted block. Only `text` blocks count.
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Edit',
            input: { file_path: '/repo/x', old_string: 'PLANNING_AGENT_FINAL:', new_string: '' },
          },
        ],
      },
    });
    expect(locateFinalBlock(event, 'PLANNING_AGENT_FINAL:')).toBeNull();
  });

  it('NDJSON fallback chooses the LAST emitted text event when multiple assistant turns exist', () => {
    const earlier = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'PLANNING_AGENT_FINAL:\n- Outcome: unclear\n- Summary: draft' },
        ],
      },
    });
    const later = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'PLANNING_AGENT_FINAL:\n- Outcome: planned\n- Summary: final' },
        ],
      },
    });
    const block = locateFinalBlock([earlier, later].join('\n'), 'PLANNING_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: planned');
    expect(block).toContain('- Summary: final');
    expect(block).not.toContain('draft');
  });

  it('strict path still wins when marker is on its own line (NDJSON fallback is a fallback)', () => {
    // If the transcript already has the marker on its own line, the strict
    // path returns the same result it always has — fallback is never
    // invoked. Documented to prevent a future refactor from accidentally
    // routing every parse through the (slower) NDJSON extractor.
    const txt = ['PLANNING_AGENT_FINAL:', '- Outcome: planned', '- Summary: ok'].join('\n');
    const block = locateFinalBlock(txt, 'PLANNING_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- Outcome: planned');
  });

  // Codex `exec --json` emits a different envelope shape than the Claude SDK:
  //   {"type":"item.completed","item":{"id":"...","type":"agent_message","text":"..."}}
  // The marker lives in `item.text` as a JSON-escaped string with literal `\n`
  // sequences. Live captured shape — see
  // src/__tests__/fixtures/completion-verifier/raw-rawlogs/codex-pull-request-final.rawlogs.txt
  it('finds the marker in a codex item.completed/agent_message envelope', () => {
    const event = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'agent_message',
        text: 'PULL_REQUEST_AGENT_FINAL:\n- pr: https://github.com/x/y/pull/1\n- summary: ok',
      },
    });
    const block = locateFinalBlock(event, 'PULL_REQUEST_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- pr: https://github.com/x/y/pull/1');
  });

  it.each([
    ['PLANNING_AGENT_FINAL:', '- outcome: planned'],
    ['EXECUTION_AGENT_FINAL:', '- outcome: implemented'],
    ['REVIEW_AGENT_FINAL:', '- pr: https://github.com/x/y/pull/1'],
    ['REMEDIATION_AGENT_FINAL:', '- outcome: implemented'],
    ['PULL_REQUEST_AGENT_FINAL:', '- comment_replied: yes'],
  ])(
    'codex envelope works for marker %s (one extractor unlocks all agent types)',
    (marker, sampleField) => {
      const event = JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: `${marker}\n${sampleField}` },
      });
      const block = locateFinalBlock(event, marker);
      expect(block).not.toBeNull();
      expect(block).toContain(sampleField);
    }
  );

  it('codex item.completed for command_execution does NOT spoof the marker even when the command output contains it', () => {
    // A command whose stdout happens to mention the marker (e.g. `cat`-ing a
    // doc) must not be mistaken for an agent-emitted block. Only
    // `agent_message` items count.
    const event = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: 'cat docs/agent-spec.md',
        aggregated_output: 'PULL_REQUEST_AGENT_FINAL:\n- pr: https://x/y/1',
        exit_code: 0,
        status: 'completed',
      },
    });
    expect(locateFinalBlock(event, 'PULL_REQUEST_AGENT_FINAL:')).toBeNull();
  });

  it('codex envelope: LAST agent_message wins when commentary precedes the final block', () => {
    const earlier = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'agent_message',
        text: 'Working on it…',
      },
    });
    const later = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'agent_message',
        text: 'PULL_REQUEST_AGENT_FINAL:\n- pr: https://x/y/2\n- summary: final',
      },
    });
    const block = locateFinalBlock([earlier, later].join('\n'), 'PULL_REQUEST_AGENT_FINAL:');
    expect(block).not.toBeNull();
    expect(block).toContain('- summary: final');
    expect(block).not.toContain('Working on it');
  });

  it('stops a Codex final block before turn.completed usage telemetry', () => {
    const transcript = [
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: [
            'REVIEW_AGENT_FINAL:',
            '- PR: https://github.com/pbuchman/intexuraos/pull/2085',
            '- review_id: 4270391498',
            '- Summary: * Reviewed the plan-only PR.',
            '* GH Actions are all passed.',
          ].join('\n'),
        },
      }),
      '[codex] {"type":"turn.completed","usage":{"input_tokens":1866673,"cached_input_tokens":1723008,"output_tokens":7853,"reasoning_output_tokens":2171}}',
      'Codex attempt finished with exit code: 0',
    ].join('\n');

    const block = locateFinalBlock(transcript, 'REVIEW_AGENT_FINAL:');

    expect(block).not.toBeNull();
    expect(block).toContain('* GH Actions are all passed.');
    expect(block).not.toContain('turn.completed');
    expect(block).not.toContain('input_tokens');
    expect(block).not.toContain('Codex attempt finished');

    const parsed = parseKeyValues(block ?? '');
    expect(parsed['Summary']).toBe('* Reviewed the plan-only PR.\n* GH Actions are all passed.');
  });

  it('stops a Codex final block before non-zero entrypoint completion lines', () => {
    const transcript = [
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: [
            'REVIEW_AGENT_FINAL:',
            '- PR: https://github.com/pbuchman/intexuraos/pull/2085',
            '- review_id: 4270391498',
            '- Summary: * Reviewed the plan-only PR.',
          ].join('\n'),
        },
      }),
      'Codex attempt finished with exit code: 1',
    ].join('\n');

    const block = locateFinalBlock(transcript, 'REVIEW_AGENT_FINAL:');

    expect(block).not.toBeNull();
    expect(block).not.toContain('Codex attempt finished');

    const parsed = parseKeyValues(block ?? '');
    expect(parsed['Summary']).toBe('* Reviewed the plan-only PR.');
  });

  it.each([0, 1])(
    'stops a Claude final block before entrypoint completion line with exit code %i',
    (exitCode) => {
      const transcript = [
        '[claude] REVIEW_AGENT_FINAL:',
        '[claude] - PR: https://github.com/pbuchman/intexuraos/pull/2099',
        '[claude] - review_id: 4372176918',
        '[claude] - Summary: * Re-review found no new issues.',
        '* Persistent CI failure remains unresolved.',
        `[entrypoint] Claude attempt finished with exit code: ${String(exitCode)}`,
      ].join('\n');

      const block = locateFinalBlock(transcript, 'REVIEW_AGENT_FINAL:');

      expect(block).not.toBeNull();
      expect(block).not.toContain('Claude attempt finished');

      const parsed = parseKeyValues(block ?? '');
      expect(parsed['Summary']).toBe(
        '* Re-review found no new issues.\n* Persistent CI failure remains unresolved.'
      );
    }
  );
});

describe('verifyCompletion summary boundaries', () => {
  it('does not include Codex turn.completed usage telemetry in verified review summaries', () => {
    const transcript = [
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: [
            'REVIEW_AGENT_FINAL:',
            '- PR: https://github.com/pbuchman/intexuraos/pull/2085',
            '- review_id: 4270391498',
            '- review_comments_posted: 0',
            '- review_types: plan_review',
            '- requirements_tracker_updated: yes',
            '- gh_actions_status: all passed',
            '- needs_remediation: 0',
            '- memory_ids_used: mem_c1f22d25-6115-4f38-825a-647ad37dec21',
            '- memory_ids_rejected: mem_6d23663d-d332-4f26-9430-31c0979b0008',
            '- memory_usage_summary: parser boundary checked',
            '- Summary: * Reviewed the plan-only PR.',
            '* GH Actions are all passed.',
          ].join('\n'),
        },
      }),
      '{"type":"turn.completed","usage":{"input_tokens":1866673,"cached_input_tokens":1723008,"output_tokens":7853,"reasoning_output_tokens":2171}}',
      'Codex attempt finished with exit code: 0',
    ].join('\n');

    const verdict = verifyCompletion({
      transcript,
      agentType: 'review',
      workerType: 'codex',
      executionMemoryContext: undefined,
      lastExitCode: undefined,
    });

    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual([]);
    expect(verdict.data['summary']).toBe(
      '* Reviewed the plan-only PR.\n* GH Actions are all passed.'
    );
  });

  it('does not include Claude runtime completion footer in verified Kimi review summaries', () => {
    const transcript = [
      '[claude] REVIEW_AGENT_FINAL:',
      '[claude] - PR: https://github.com/pbuchman/intexuraos/pull/2099',
      '[claude] - review_id: 4372176918',
      '[claude] - review_comments_posted: 0',
      '[claude] - review_types: code_quality,security,architecture,test_quality',
      '[claude] - requirements_tracker_updated: yes',
      '[claude] - gh_actions_status: 1 failed',
      '[claude] - needs_remediation: 0',
      '[claude] - memory_ids_used: none',
      '[claude] - memory_ids_rejected: none',
      '[claude] - memory_usage_summary: none',
      '[claude] - Summary: * Re-review found no new issues.',
      '* Persistent CI failure remains unresolved.',
      '[entrypoint] Claude attempt finished with exit code: 0',
    ].join('\n');

    const verdict = verifyCompletion({
      transcript,
      agentType: 'review',
      workerType: 'kimi',
      executionMemoryContext: undefined,
      lastExitCode: undefined,
    });

    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual([]);
    expect(verdict.data['summary']).toBe(
      '* Re-review found no new issues.\n* Persistent CI failure remains unresolved.'
    );
  });
});

describe('parseKeyValues', () => {
  it('parses simple "- key: value" pairs', () => {
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- pr: https://github.com/x/y/pull/1',
      '- summary: ok',
    ].join('\n');
    expect(parseKeyValues(block)).toEqual({
      Outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
    });
  });

  it('preserves case in keys (does not normalize)', () => {
    const block = ['EXECUTION_AGENT_FINAL:', '- Outcome: implemented', '- CI evidence: ok'].join(
      '\n'
    );
    expect(parseKeyValues(block)).toHaveProperty('CI evidence', 'ok');
    expect(parseKeyValues(block)).toHaveProperty('Outcome', 'implemented');
  });

  it('strips paired markdown emphasis from values (**, *, `, _)', () => {
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: **implemented**',
      '- pr: `https://github.com/x/y/pull/1`',
      '- summary: _ok_',
    ].join('\n');
    const parsed = parseKeyValues(block);
    expect(parsed['Outcome']).toBe('implemented');
    expect(parsed['pr']).toBe('https://github.com/x/y/pull/1');
    expect(parsed['summary']).toBe('ok');
  });

  it('joins continuation lines (indented under a key) into the value', () => {
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- summary:',
      '  * first bullet',
      '  * second bullet',
      '- pr: https://github.com/x/y/pull/1',
    ].join('\n');
    const parsed = parseKeyValues(block);
    expect(parsed['summary']).toBe('* first bullet\n  * second bullet');
    expect(parsed['pr']).toBe('https://github.com/x/y/pull/1');
  });

  it('treats non-key lines after a key as continuation (bullets without indent)', () => {
    // [INT-1470] Agents commonly emit unindented bulleted summaries:
    //   - Summary:
    //   * bullet 1
    //   * bullet 2
    // The old parser closed the key on the `*` lines and returned an empty
    // `Summary`, falsely marking it missing. The new parser keeps appending
    // until the next "- key:" line appears.
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- Summary:',
      '* bullet 1',
      '* bullet 2',
      '- pr: https://github.com/x/y/pull/1',
    ].join('\n');
    const parsed = parseKeyValues(block);
    expect(parsed['Outcome']).toBe('implemented');
    expect(parsed['Summary']).toContain('bullet 1');
    expect(parsed['Summary']).toContain('bullet 2');
    expect(parsed['pr']).toBe('https://github.com/x/y/pull/1');
  });

  it('does not misinterpret summary bullets containing colons as new keys', () => {
    // [INT-1470 review follow-up] A `- Key decision: ...` prose bullet
    // inside a `- Summary:` block must NOT be parsed as a new top-level
    // key. The key-line regex alone would match, but the whitelist check
    // against AGENT_CONTRACTS keys keeps these bullets glued to the
    // currently-open summary value.
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- pr: https://github.com/x/y/pull/1',
      '- Summary:',
      '- Key decision: rewrote the verifier',
      '- Another thing: yes',
    ].join('\n');
    const parsed = parseKeyValues(block);
    expect(parsed['Outcome']).toBe('implemented');
    expect(parsed['pr']).toBe('https://github.com/x/y/pull/1');
    expect(parsed['Summary']).toContain('Key decision: rewrote the verifier');
    expect(parsed['Summary']).toContain('Another thing: yes');
    expect(parsed).not.toHaveProperty('Key decision');
    expect(parsed).not.toHaveProperty('Another thing');
  });

  it('handles the minimax bold-every-value fixture', () => {
    const txt = readFixture('execution/minimax/task_24eb987c-361e-4973-90a8-229e7432b645.txt');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    const parsed = parseKeyValues(block as string);
    expect(parsed['Outcome']).toBe('implemented');
    expect(parsed['PR']).toBe('https://github.com/pbuchman/intexuraos/pull/1925');
    expect(parsed['execution_memory_ids_used']).toMatch(/^mem_463bb567/);
  });
});

describe('coerceFields', () => {
  it('returns empty-alias coercion for memory csv (none/None/N/A/empty)', () => {
    const record = {
      outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
      memory_ids_used: 'none',
      memory_ids_rejected: 'None',
      memory_usage_summary: '',
    };
    const { data, missingRequired, warnings } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toEqual([]);
    expect(warnings).toEqual([]);
    expect(data['memory_ids_used']).toEqual([]);
    expect(data['memory_ids_rejected']).toEqual([]);
    expect(data['memory_usage_summary']).toBe('');
  });

  it('accepts Linear issue none for pull request agent completion', () => {
    const record = {
      pr: 'https://github.com/x/y/pull/1',
      ci_evidence: 'pnpm run ci:tracked successful',
      linear_issue: 'none',
      comment_replied: 'yes',
      tracking_comment_id: '12345',
      tracking_comment: 'updated',
      total_pr_comments_posted: '1',
      memory_ids_used: 'none',
      memory_ids_rejected: 'none',
      memory_usage_summary: 'none',
      summary: '* Addressed PR feedback without a Linear issue.',
    };

    const { data, missingRequired, warnings } = coerceFields(record, AGENT_CONTRACTS.pull_request);

    expect(missingRequired).toEqual([]);
    expect(warnings).toEqual([]);
    expect(data['linear_issue']).toBe('');
  });

  it('reports missing required fields when absent', () => {
    const record = { outcome: 'implemented', summary: 'ok' }; // no pr
    const { missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toContain('pr');
  });

  it('does NOT report pr as missing when outcome=failed (pr is deliverable-optional for failed)', () => {
    const record = { outcome: 'failed', summary: 'interrupted', pr: '' };
    const { missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).not.toContain('pr');
  });

  it('resolves aliases (execution_memory_ids_used → memory_ids_used)', () => {
    const record = {
      outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
      execution_memory_ids_used: 'mem_a,mem_b',
      execution_memory_ids_rejected: 'none',
    };
    const { data, warnings } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(data['memory_ids_used']).toEqual(['mem_a', 'mem_b']);
    expect(
      warnings.some((w) => w.includes('execution_memory_ids_used') && w.includes('alias'))
    ).toBe(true);
  });

  it('[INT-1470] does NOT warn for case/whitespace-only alias differences (Outcome vs outcome, CI evidence vs ci_evidence)', () => {
    const record = {
      // Every key here differs from its canonical name only in case/punctuation.
      Outcome: 'implemented',
      PR: 'https://github.com/x/y/pull/1',
      Summary: 'ok',
      'CI evidence': 'ci green',
      'Linear issue': 'https://linear.app/x/issue/X-1',
      'Review iterations': '2',
      'Skill sequence proof': 'proof',
    };
    const { warnings } = coerceFields(record, AGENT_CONTRACTS.execution);
    // None of the above differ semantically — the alias lookup just
    // picks up the casing variant. No warning should be emitted.
    expect(warnings.filter((w) => w.includes('alias'))).toEqual([]);
  });

  it('[INT-1470] still warns for semantic-rename aliases (execution_memory_* → memory_*)', () => {
    const record = {
      outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
      execution_memory_ids_used: 'mem_a',
    };
    const { warnings } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(
      warnings.some((w) => w.includes('execution_memory_ids_used') && w.includes('alias'))
    ).toBe(true);
  });

  it('coerces bool01 from multiple accepted formats', () => {
    const cases: [string, boolean][] = [
      ['0', false],
      ['1', true],
      ['yes', true],
      ['no', false],
      ['true', true],
      ['false', false],
      ['used', true],
      ['not used', false],
      ['not_used', false],
    ];
    for (const [input, expected] of cases) {
      const record = {
        outcome: 'implemented',
        pr: 'https://github.com/x/y/pull/1',
        summary: 'ok',
        trivial_task: input,
      };
      const { data } = coerceFields(record, AGENT_CONTRACTS.execution);
      expect(data['trivial_task'], `input ${input}`).toBe(expected);
    }
  });

  it('emits warning (not failure) for malformed int', () => {
    const record = {
      outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
      review_iterations: 'two',
    };
    const { data, warnings, missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toEqual([]);
    expect(data['review_iterations']).toBeNull();
    expect(warnings.some((w) => w.includes('review_iterations'))).toBe(true);
  });

  it('rejects enum values case-insensitively but reports in canonical case', () => {
    const record = {
      outcome: 'IMPLEMENTED',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
    };
    const { data, missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toEqual([]);
    expect(data['outcome']).toBe('implemented');
  });

  it('[INT-1470 coverage] warns (not fails) when optional url field is non-http', () => {
    // execution.linear_issue is optional kind='url'. Non-http value must
    // warn but not push into missingRequired.
    const record = {
      outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
      linear_issue: 'not-a-url',
    };
    const { missingRequired, warnings, data } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).not.toContain('linear_issue');
    expect(warnings.some((w) => w.includes('linear_issue') && w.includes('not an http'))).toBe(
      true
    );
    expect(data['linear_issue']).toBe('');
  });

  it('[INT-1470 coverage] reports required enum in missingRequired when value is unknown', () => {
    // execution.outcome is a required enum. A value outside {implemented,
    // already_completed, failed} must push into missingRequired (not just warn).
    const record = {
      outcome: 'bogus-outcome',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
    };
    const { missingRequired, data } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toContain('outcome');
    expect(data['outcome']).toBe('');
  });

  it('[INT-1470 coverage] uses canonical execution pr exemption when outcome=failed via Outcome (capital O) key', () => {
    // Exercise the `record['Outcome']` fallback arm in the
    // `(record['outcome'] ?? record['Outcome'] ?? '').trim().toLowerCase()`
    // expression at the execution pr-exemption check.
    const record = {
      Outcome: 'failed',
      summary: 'interrupted',
      pr: '',
    };
    const { missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).not.toContain('pr');
  });

  it('[INT-1470 review follow-up] execution pr exemption still reports pr missing when neither outcome nor Outcome key is present', () => {
    // Covers the `?? ''` fallback arm of the
    // `(record['outcome'] ?? record['Outcome'] ?? '').trim().toLowerCase()`
    // expression. With neither key, the comparison yields '' !== 'failed',
    // so the exemption does NOT apply and pr is still reported missing.
    const record = {
      summary: 'ok',
      pr: '',
    };
    const { missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toContain('pr');
    expect(missingRequired).toContain('outcome');
  });

  it('[INT-1470 coverage] emits unknown-key warning for keys not in the contract', () => {
    const record = {
      outcome: 'implemented',
      pr: 'https://github.com/x/y/pull/1',
      summary: 'ok',
      totally_unknown_key: 'some value',
    };
    const { warnings } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(
      warnings.some((w) => w.includes('unknown key') && w.includes('totally_unknown_key'))
    ).toBe(true);
  });

  it('fails when url field is non-http', () => {
    const record = {
      outcome: 'implemented',
      pr: 'not-a-url',
      summary: 'ok',
    };
    const { missingRequired } = coerceFields(record, AGENT_CONTRACTS.execution);
    expect(missingRequired).toContain('pr');
  });
});

interface FixtureDescriptor {
  agentType: keyof typeof AGENT_CONTRACTS;
  workerType: string;
  taskId: string;
  txtPath: string;
  expectedPath: string;
}

function discoverFixtures(): FixtureDescriptor[] {
  const out: FixtureDescriptor[] = [];
  const agentTypes = ['execution', 'planning', 'review', 'remediation', 'pull_request'] as const;
  for (const agentType of agentTypes) {
    const agentDir = join(FIXTURE_ROOT, agentType);
    if (!existsSync(agentDir)) continue;
    for (const workerType of readdirSync(agentDir)) {
      const workerDir = join(agentDir, workerType);
      for (const file of readdirSync(workerDir)) {
        if (!file.endsWith('.txt')) continue;
        // Skip negative fixtures (covered by dedicated tests below).
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

const REGEN = process.env['REGEN_FIXTURES'] === '1';

describe('fixture golden-file parser replay', () => {
  const fixtures = discoverFixtures();
  it('discovers at least 100 fixtures (sanity)', () => {
    expect(fixtures.length).toBeGreaterThan(100);
  });

  it.each(fixtures)('$agentType/$workerType/$taskId', ({ agentType, txtPath, expectedPath }) => {
    const contract = AGENT_CONTRACTS[agentType];
    const transcript = readFileSync(txtPath, 'utf8');
    const block = locateFinalBlock(transcript, contract.marker);
    expect(block, `no block located in ${txtPath}`).not.toBeNull();
    const record = parseKeyValues(block as string);
    const { data, missingRequired, warnings } = coerceFields(record, contract);
    const actual = { data, missingRequired, warnings };

    if (REGEN || !existsSync(expectedPath)) {
      writeFileSync(expectedPath, JSON.stringify(actual, null, 2) + '\n');
    }
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as typeof actual;
    expect(actual).toEqual(expected);
  });
});

describe('negative fixtures', () => {
  it('negative fixture: task_536a87b7 has no real EXECUTION_AGENT_FINAL block', () => {
    const txt = readFixture(
      'execution/opus/task_536a87b7-6565-4442-a446-392c33223bb0.negative.txt'
    );
    expect(locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:')).toBeNull();
  });
});

const intOnlyContract: AgentContract = {
  marker: 'TEST_AGENT_FINAL:',
  fields: [{ name: 'count', kind: 'int', required: false }],
};

describe('coerceFields int leniency', () => {
  it('accepts pure integer', () => {
    const result = coerceFields({ count: '5' }, intOnlyContract);
    expect(result.data['count']).toBe(5);
    expect(result.warnings).toEqual([]);
  });

  it('extracts leading integer followed by parenthesized annotation', () => {
    const result = coerceFields(
      { count: '0 (review submitted as single body with no inline comments)' },
      intOnlyContract
    );
    expect(result.data['count']).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('extracts negative leading integer with annotation', () => {
    const result = coerceFields({ count: '-3 (failed sub-checks)' }, intOnlyContract);
    expect(result.data['count']).toBe(-3);
  });

  it('still rejects fully non-numeric', () => {
    const result = coerceFields({ count: 'two' }, intOnlyContract);
    expect(result.data['count']).toBe(null);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('not a valid int')])
    );
  });
});
