import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  locateFinalBlock,
  parseKeyValues,
} from '../../../services/completion-verifier/block-parser.js';

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
    const txt = readFixture('execution/opus/task_536a87b7-6565-4442-a446-392c33223bb0.txt');
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

  it('ignores lines that are not "- key: value"', () => {
    const block = [
      'EXECUTION_AGENT_FINAL:',
      '- Outcome: implemented',
      '',
      'Some narrative in the middle',
      '',
      '- pr: https://github.com/x/y/pull/1',
    ].join('\n');
    const parsed = parseKeyValues(block);
    expect(parsed.Outcome).toBe('implemented');
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
