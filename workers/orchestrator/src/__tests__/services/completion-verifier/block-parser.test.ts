import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  locateFinalBlock,
  parseKeyValues,
  coerceFields,
} from '../../../services/completion-verifier/block-parser.js';
import { AGENT_CONTRACTS } from '../../../services/completion-verifier/contracts.js';

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
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '- CI evidence: ok',
    ].join('\n');
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
    expect(parsed.Outcome).toBe('implemented');
    expect(parsed.pr).toBe('https://github.com/x/y/pull/1');
    expect(parsed.summary).toBe('ok');
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
    expect(parsed.summary).toBe('* first bullet\n  * second bullet');
    expect(parsed.pr).toBe('https://github.com/x/y/pull/1');
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
    expect(parsed.Outcome).toBe('implemented');
    expect(parsed.Summary).toContain('bullet 1');
    expect(parsed.Summary).toContain('bullet 2');
    expect(parsed.pr).toBe('https://github.com/x/y/pull/1');
  });

  it('handles the minimax bold-every-value fixture', () => {
    const txt = readFixture('execution/minimax/task_24eb987c-361e-4973-90a8-229e7432b645.txt');
    const block = locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:');
    expect(block).not.toBeNull();
    const parsed = parseKeyValues(block as string);
    expect(parsed.Outcome).toBe('implemented');
    expect(parsed.PR).toBe('https://github.com/pbuchman/intexuraos/pull/1925');
    expect(parsed.execution_memory_ids_used).toMatch(/^mem_463bb567/);
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
    expect(data.memory_ids_used).toEqual([]);
    expect(data.memory_ids_rejected).toEqual([]);
    expect(data.memory_usage_summary).toBe('');
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
    expect(data.memory_ids_used).toEqual(['mem_a', 'mem_b']);
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
    const cases: Array<[string, boolean]> = [
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
      expect(data.trivial_task, `input ${input}`).toBe(expected);
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
    expect(data.review_iterations).toBeNull();
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
    expect(data.outcome).toBe('implemented');
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

const REGEN = process.env.REGEN_FIXTURES === '1';

describe('fixture golden-file parser replay', () => {
  const fixtures = discoverFixtures();
  it('discovers at least 100 fixtures (sanity)', () => {
    expect(fixtures.length).toBeGreaterThan(100);
  });

  it.each(fixtures)(
    '$agentType/$workerType/$taskId',
    ({ agentType, txtPath, expectedPath }) => {
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
    }
  );
});

describe('negative fixtures', () => {
  it('negative fixture: task_536a87b7 has no real EXECUTION_AGENT_FINAL block', () => {
    const txt = readFixture(
      'execution/opus/task_536a87b7-6565-4442-a446-392c33223bb0.negative.txt'
    );
    expect(locateFinalBlock(txt, 'EXECUTION_AGENT_FINAL:')).toBeNull();
  });
});
