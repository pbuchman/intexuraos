import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MATRIX_CORPUS_AGENT_MODEL,
  MATRIX_CORPUS_JUDGE_MODEL,
  loadCanonicalMatrixCorpus,
} from '../matrixCorpus/catalog.js';

const scenariosDirectory = fileURLToPath(new URL('../../scenarios/', import.meta.url));

describe('canonical Matrix corpus catalog', () => {
  it('freezes the 20-scenario, 59-turn DeepSeek/MiniMax run profile', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);

    expect(catalog.agentModel).toBe('or:deepseek/deepseek-v4-flash');
    expect(catalog.evaluatorModel).toBe('or:minimax/minimax-m3');
    expect(MATRIX_CORPUS_AGENT_MODEL).toBe(catalog.agentModel);
    expect(MATRIX_CORPUS_JUDGE_MODEL).toBe(catalog.evaluatorModel);
    expect(catalog.scenarios.map(({ scenario }) => scenario.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `intex-eval-${String(index + 1).padStart(3, '0')}`)
    );
    expect(catalog.scenarioCount).toBe(20);
    expect(catalog.turnCount).toBe(59);
    expect(Math.max(...catalog.scenarios.map(({ scenario }) => scenario.turns.length))).toBe(20);
  });

  it('builds the same canonical corpus with MiniMax M3 as the immutable agent model', async () => {
    const deepSeek = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const miniMax = await loadCanonicalMatrixCorpus(scenariosDirectory, 'or:minimax/minimax-m3');

    expect(miniMax.agentModel).toBe('or:minimax/minimax-m3');
    expect(miniMax.evaluatorModel).toBe('or:minimax/minimax-m3');
    expect(miniMax.scenarioCount).toBe(20);
    expect(miniMax.turnCount).toBe(59);
    expect(miniMax.scenarios).toEqual(deepSeek.scenarios);
    expect(miniMax.catalogDigest).not.toBe(deepSeek.catalogDigest);
  });

  it('builds closed, digest-stable profiles without duplicating the scenario content', async () => {
    const first = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const second = await loadCanonicalMatrixCorpus(scenariosDirectory);

    expect(second.catalogDigest).toBe(first.catalogDigest);
    expect(new Set(first.scenarios.map(({ scenarioDigest }) => scenarioDigest)).size).toBe(20);
    expect(
      first.scenarios.every(({ mockProfileDigest }) => /^[0-9a-f]{64}$/u.test(mockProfileDigest))
    ).toBe(true);

    for (const entry of first.scenarios) {
      expect(entry.scenarioNumber).toBe(Number(entry.scenario.id.slice(-3)));
      expect(entry.scenarioLabel).toBe(entry.scenario.title);
      if (entry.scenarioNumber === 1)
        expect(entry.scenarioLabel).toBe('Create a note in one message');
      expect(entry.mockProfile.unexpectedKnownToolPolicy).toBe('behavioral_failure_no_execution');
      expect(entry.expectedToolSchedule).toEqual(
        entry.mockProfile.calls.map(({ turnIndex, toolName, ordinal }) => ({
          turnIndex,
          toolName,
          ordinal,
        }))
      );

      const scheduled = new Set(
        entry.mockProfile.calls.map(({ turnIndex, toolName }) => `${String(turnIndex)}:${toolName}`)
      );
      const forbidden = new Set(
        entry.mockProfile.forbiddenSelections.map(
          ({ turnIndex, toolName }) => `${String(turnIndex)}:${toolName}`
        )
      );
      expect([...scheduled].some((key) => forbidden.has(key))).toBe(false);
      expect(
        entry.scenario.turns.every(
          (turn, turnIndex) =>
            turn.kind !== 'confirmation_button' ||
            (turn.previousTurnIndex < turnIndex &&
              entry.scenario.turns[turn.previousTurnIndex]?.kind === 'message')
        )
      ).toBe(true);
    }
  });

  it('keeps every isolated preference mutation on its own version-zero overlay', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    for (const scenarioId of ['intex-eval-017', 'intex-eval-018', 'intex-eval-019']) {
      const entry = catalog.scenarios.find(({ scenario }) => scenario.id === scenarioId);
      const result = entry?.mockProfile.calls[0]?.outcome;
      expect(result?.kind).toBe('success');
      if (result?.kind === 'success' && 'currentVersion' in result.result)
        expect(result.result.currentVersion).toBe(1);
    }
  });
});
