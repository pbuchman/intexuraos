import { describe, expect, it } from 'vitest';
import {
  digestMatrixCorpusPromptV1,
  normalizeMatrixCorpusPromptV1,
  parseMatrixCorpusVisibleMessage,
} from '../../../domain/matrixCorpus/visibleHeader.js';

const capability = `imc1_${'A'.repeat(43)}`;
const startHeader = `new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · ${capability}`;
const turnHeader = `🧪 Scenario 001/020 · step 2/5 · ${capability}`;
const confirmationHeader = `🧪 Scenario 001/020 · confirmation · ${capability}`;

describe('parseMatrixCorpusVisibleMessage', () => {
  it('parses a valid start header and retains only the canonical new-session prompt', () => {
    expect(parseMatrixCorpusVisibleMessage(`${startHeader}\n\nhello`)).toEqual({
      kind: 'matrix_corpus', version: 1, phase: 'start', scenarioNumber: 1, scenarioTotal: 20,
      capability, naturalBody: 'hello', textAfterHeaderRemoval: 'new session: hello', startNewSession: true,
    });
  });

  it('does not duplicate an idle new-session command from the natural body', () => {
    expect(parseMatrixCorpusVisibleMessage(`${startHeader}\n\nnew session`)).toEqual({
      kind: 'matrix_corpus', version: 1, phase: 'start', scenarioNumber: 1, scenarioTotal: 20,
      capability, naturalBody: 'new session', textAfterHeaderRemoval: 'new session', startNewSession: true,
    });
  });

  it('parses distinct turn and confirmation headers', () => {
    expect(parseMatrixCorpusVisibleMessage(`${turnHeader}\n\nbody`)).toMatchObject({
      kind: 'matrix_corpus', phase: 'turn', turnIndex: 2, turnTotal: 5, naturalBody: 'body', textAfterHeaderRemoval: 'body', startNewSession: false,
    });
    expect(parseMatrixCorpusVisibleMessage(`${confirmationHeader}\n\nbody`)).toMatchObject({
      kind: 'matrix_corpus', phase: 'confirmation', turnIndex: null, turnTotal: null, naturalBody: 'body', textAfterHeaderRemoval: 'body', startNewSession: false,
    });
  });

  it('accepts each exact separator without rewriting Unicode, whitespace, or line endings in the body', () => {
    const bodies = [
      '\r\n leading\r\ncombining e\u0301  \n',
      ' composed é\rtrailing  \n',
      '  body\r',
    ];
    const separators = ['\n\n', '\r\n\r\n', '\r\r'];
    for (const [index, separator] of separators.entries()) {
      const body = bodies[index] ?? '';
      expect(parseMatrixCorpusVisibleMessage(`${turnHeader}${separator}${body}`)).toMatchObject({ naturalBody: body, textAfterHeaderRemoval: body });
    }
    expect(
      parseMatrixCorpusVisibleMessage(`${turnHeader}\r\rbody before later separator\n\nlater`)
    ).toMatchObject({ naturalBody: 'body before later separator\n\nlater' });
  });

  it('normalizes only line endings and NFC before producing the canonical digest', () => {
    expect(normalizeMatrixCorpusPromptV1('  e\u0301\r\nline\r  ')).toBe('  é\nline\n  ');
    expect(digestMatrixCorpusPromptV1({ body: 'a\r\nb', startNewSession: true })).toBe(
      digestMatrixCorpusPromptV1({ body: 'a\nb', startNewSession: true })
    );
    expect(digestMatrixCorpusPromptV1({ body: 'e\u0301', startNewSession: true })).toBe(
      digestMatrixCorpusPromptV1({ body: 'é', startNewSession: true })
    );
    expect(digestMatrixCorpusPromptV1({ body: 'a b', startNewSession: true })).not.toBe(
      digestMatrixCorpusPromptV1({ body: 'a  b', startNewSession: true })
    );
    expect(digestMatrixCorpusPromptV1({ body: 'abc', startNewSession: true })).not.toBe(
      digestMatrixCorpusPromptV1({ body: 'abd', startNewSession: true })
    );
    expect(digestMatrixCorpusPromptV1({ body: 'abc', startNewSession: true })).not.toBe(
      digestMatrixCorpusPromptV1({ body: 'abc', startNewSession: false })
    );
    expect(digestMatrixCorpusPromptV1({ body: 'abc', startNewSession: true })).toBe('0740cd576a67673ed8c9e3c085a5e6e06ba128e6f92841497a9225453d1104be');
    expect(digestMatrixCorpusPromptV1({ body: 'abc', startNewSession: true })).toMatch(/^[0-9a-f]{64}$/);
    expect(() => digestMatrixCorpusPromptV1({ body: '', startNewSession: true })).toThrow('Invalid Matrix corpus prompt digest input');
    expect(() => digestMatrixCorpusPromptV1({ body: 'x'.repeat(4097), startNewSession: true })).toThrow(
      'Invalid Matrix corpus prompt digest input'
    );
  });

  it('fails closed for every malformed reserved prefix', () => {
    const malformed = [
      `${startHeader.replace('imc1_', 'imc2_')}\n\nbody`,
      `${startHeader.replace(capability, `imc1_${'A'.repeat(42)}`)}\n\nbody`,
      `${startHeader.replace(capability, `imc1_${'A'.repeat(44)}`)}\n\nbody`,
      `${startHeader.replace('Matrix corpus', 'matrix corpus')}\n\nbody`,
      `${startHeader.replace('tools mocked', 'tools real')}\n\nbody`,
      `${startHeader.replace('🧪', '🧫')}\n\nbody`,
      `${startHeader.replace(' · ', '·')}\n\nbody`,
      `${startHeader.replace('001/020', '021/020')}\n\nbody`,
      `${startHeader.replace('001/020', '1/020')}\n\nbody`,
      `${startHeader.replace('001/020', '001/021')}\n\nbody`,
      `${turnHeader.replace('2/5', '0/5')}\n\nbody`,
      `${turnHeader.replace('2/5', '5/2')}\n\nbody`,
      `${turnHeader.replace('2/5', '21/21')}\n\nbody`,
      `${confirmationHeader.replace('001/020', '021/020')}\n\nbody`,
      `${startHeader.replace(' · Matrix corpus · tools mocked', ' · step 1/1')}\n\nbody`,
      `${confirmationHeader.replace(' · confirmation · ', ' · confirmation · step 1/1 · ')}\n\nbody`,
      `${turnHeader}\nbody`, `${turnHeader}\t\tbody`, `${turnHeader}\r\n\nbody`, `${turnHeader}\n\n`,
      `${startHeader}${'x'.repeat(257)}\n\nbody`,
      `${turnHeader}\n\n${'x'.repeat(4097)}`,
    ];
    for (const text of malformed) {
      expect(parseMatrixCorpusVisibleMessage(text)).toMatchObject({ kind: 'reserved_malformed' });
    }
  });

  it('fails closed for narrow capability-bearing header lookalikes while retaining ordinary scenario prose', () => {
    const lookalikes = [
      `${startHeader.replace('new session:', 'new Session:')}\n\nbody`,
      `${startHeader.replace('🧪', '🧫')}\n\nbody`,
      `${turnHeader.replace('Scenario', 'scenario')}\n\nbody`,
    ];
    for (const text of lookalikes) {
      expect(parseMatrixCorpusVisibleMessage(text)).toMatchObject({ kind: 'reserved_malformed' });
    }
    expect(parseMatrixCorpusVisibleMessage('new session: plan Scenario normal request')).toEqual({ kind: 'ordinary' });
  });

  it('fails closed for unvalidated first-line corpus lookalike combinations without returning transport content', () => {
    const lookalikes = [
      `${startHeader.replace('new session:', 'new Session:').replace('001/020', '001/021')}\n\nbody`,
      `${startHeader.replace('🧪', '🧫').replace('001/020', '001/20')}\n\nbody`,
      `${turnHeader.replace('🧪 Scenario', '🧫 scenario').replace(capability, `imc2_${'A'.repeat(43)}`)}\n\nbody`,
      `${turnHeader.replace('🧪 Scenario', '🧫 scenario').replace(capability, `imc1_${'A'.repeat(42)}`)}\n\nbody`,
      `${turnHeader.replace('🧪 Scenario', '🧫 scenario').replace(capability, `imc1_${'A'.repeat(44)}`)}\n\nbody`,
      `${turnHeader.replace('🧪 Scenario', '🧫 scenario').replace(capability, 'imc1_short')}\n\nbody`,
      `${startHeader.replace('new session:', 'new Session:').replace('Matrix corpus', 'Matrix Corpus')}\n\nbody`,
      `${turnHeader.replace('🧪 Scenario', '🧫 scenario').replace(' · step ', '·step ')}\n\nbody`,
    ];
    for (const text of lookalikes) {
      const result = parseMatrixCorpusVisibleMessage(text);
      expect(result).toEqual({ kind: 'reserved_malformed', reason: expect.any(String) });
      expect(result).not.toHaveProperty('capability');
      expect(result).not.toHaveProperty('naturalBody');
    }
    expect(parseMatrixCorpusVisibleMessage('new session: plan Scenario normal request')).toEqual({ kind: 'ordinary' });
    expect(parseMatrixCorpusVisibleMessage('🧪 prose about Scenario without corpus markers')).toEqual({ kind: 'ordinary' });
    expect(parseMatrixCorpusVisibleMessage('🧫 Scenario 001/020 plans for today')).toEqual({ kind: 'ordinary' });
    expect(parseMatrixCorpusVisibleMessage('🧫 Scenario 001/020 footsteps for today')).toEqual({ kind: 'ordinary' });
    expect(parseMatrixCorpusVisibleMessage('🧫 Scenario 001/020 plans for the next step')).toEqual({ kind: 'ordinary' });
    expect(parseMatrixCorpusVisibleMessage('🧫 Scenario 001/020 notes about fooimc1_')).toEqual({ kind: 'ordinary' });
    expect(parseMatrixCorpusVisibleMessage('🧫 Scenario 001/020 notes about notimc_')).toEqual({ kind: 'ordinary' });
    expect(parseMatrixCorpusVisibleMessage('🧫 Scenario 001/020 · notes about fooimc1_')).toEqual({ kind: 'ordinary' });
    expect(parseMatrixCorpusVisibleMessage('🧫 Scenario 001/020 · notes about notimc_')).toEqual({ kind: 'ordinary' });
  });

  it('rejects a second full separator but preserves a natural body beginning with one line ending', () => {
    for (const separator of ['\n\n', '\r\n\r\n', '\r\r']) {
      expect(parseMatrixCorpusVisibleMessage(`${turnHeader}${separator}${separator}body`)).toMatchObject({
        kind: 'reserved_malformed',
      });
    }
    expect(parseMatrixCorpusVisibleMessage(`${turnHeader}\n\n\nbody`)).toMatchObject({
      kind: 'matrix_corpus',
      naturalBody: '\nbody',
    });
    expect(parseMatrixCorpusVisibleMessage(`${turnHeader}\r\n\r\n\r\nbody`)).toMatchObject({
      kind: 'matrix_corpus',
      naturalBody: '\r\nbody',
    });
    expect(parseMatrixCorpusVisibleMessage(`${turnHeader}\r\r\rbody`)).toMatchObject({
      kind: 'matrix_corpus',
      naturalBody: '\rbody',
    });
  });

  it('leaves non-reserved ordinary text untouched', () => {
    expect(parseMatrixCorpusVisibleMessage('new session: ordinary request')).toEqual({ kind: 'ordinary' });
    expect(parseMatrixCorpusVisibleMessage('🧪 not a scenario')).toEqual({ kind: 'ordinary' });
  });
});
