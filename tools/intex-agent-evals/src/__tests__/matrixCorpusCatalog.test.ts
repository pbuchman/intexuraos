import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MATRIX_CORPUS_AGENT_MODEL,
  MATRIX_CORPUS_JUDGE_MODEL,
  loadCanonicalMatrixCorpus,
} from '../matrixCorpus/catalog.js';

const scenariosDirectory = fileURLToPath(new URL('../../scenarios/', import.meta.url));

describe('canonical Matrix corpus catalog', () => {
  it('freezes the 20-scenario, 60-turn DeepSeek/MiniMax run profile', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);

    expect(catalog.agentModel).toBe('or:deepseek/deepseek-v4-flash');
    expect(catalog.evaluatorModel).toBe('or:minimax/minimax-m3');
    expect(MATRIX_CORPUS_AGENT_MODEL).toBe(catalog.agentModel);
    expect(MATRIX_CORPUS_JUDGE_MODEL).toBe(catalog.evaluatorModel);
    expect(catalog.scenarios.map(({ scenario }) => scenario.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `intex-eval-${String(index + 1).padStart(3, '0')}`)
    );
    expect(catalog.scenarioCount).toBe(20);
    expect(catalog.turnCount).toBe(60);
    expect(Math.max(...catalog.scenarios.map(({ scenario }) => scenario.turns.length))).toBe(20);
  });

  it('builds the same canonical corpus with MiniMax M3 as the immutable agent model', async () => {
    const deepSeek = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const miniMax = await loadCanonicalMatrixCorpus(scenariosDirectory, 'or:minimax/minimax-m3');

    expect(miniMax.agentModel).toBe('or:minimax/minimax-m3');
    expect(miniMax.evaluatorModel).toBe('or:minimax/minimax-m3');
    expect(miniMax.scenarioCount).toBe(20);
    expect(miniMax.turnCount).toBe(60);
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

  it('builds a closed nine-event weekly lookup narrowed to four Google Photos updates', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const entry = catalog.scenarios.find(({ scenario }) => scenario.id === 'intex-eval-008');
    if (entry === undefined) throw new Error('Missing scenario 008');
    const expectedPhotosTitles = [
      'Google Photos od 04.2019',
      'Wyczyścić Photos 2018',
      'Wyczyścić Photos 2017',
      'Wyczyścić Photos 2016',
    ] as const;

    expect(entry.expectedToolSchedule).toEqual([
      { turnIndex: 0, toolName: 'query_calendar_events', ordinal: 1 },
      { turnIndex: 2, toolName: 'query_calendar_events', ordinal: 1 },
      ...[1, 2, 3, 4].map((ordinal) => ({
        turnIndex: 3,
        toolName: 'update_calendar_event' as const,
        ordinal,
      })),
    ]);

    const lookupCalls = entry.mockProfile.calls.filter(
      ({ toolName }) => toolName === 'query_calendar_events'
    );
    expect(lookupCalls).toHaveLength(2);
    const weeklyLookup = lookupCalls.find(({ turnIndex }) => turnIndex === 0);
    const photosLookup = lookupCalls.find(({ turnIndex }) => turnIndex === 2);
    expect(weeklyLookup?.argumentCatalog).toEqual({
      toolName: 'query_calendar_events',
      timeMin: '2026-08-10T00:00:00+02:00',
      timeMax: '2026-08-17T00:00:00+02:00',
      query: 'INTEX-EVAL-008 INTEX-EVAL-008-F01',
    });
    expect(photosLookup?.argumentCatalog).toEqual({
      toolName: 'query_calendar_events',
      timeMin: '2026-08-13T00:00:00+02:00',
      timeMax: '2026-08-17T00:00:00+02:00',
      query: 'Photos INTEX-EVAL-008 INTEX-EVAL-008-F01',
    });
    expect(weeklyLookup?.outcome.kind).toBe('success');
    expect(photosLookup?.outcome.kind).toBe('success');
    if (weeklyLookup?.outcome.kind !== 'success' || photosLookup?.outcome.kind !== 'success')
      return;
    expect(weeklyLookup.outcome.result).toMatchObject({
      toolName: 'query_calendar_events',
      status: 'completed',
      mode: 'list',
      count: 9,
      truncated: false,
    });
    expect(photosLookup.outcome.result).toMatchObject({
      toolName: 'query_calendar_events',
      status: 'completed',
      mode: 'list',
      count: 4,
      truncated: false,
    });
    if (
      weeklyLookup.outcome.result.toolName !== 'query_calendar_events' ||
      weeklyLookup.outcome.result.mode !== 'list' ||
      photosLookup.outcome.result.toolName !== 'query_calendar_events' ||
      photosLookup.outcome.result.mode !== 'list'
    ) {
      return;
    }
    expect(weeklyLookup.outcome.result.events).toHaveLength(9);
    for (const lookup of [weeklyLookup, photosLookup]) {
      if (
        lookup.argumentCatalog?.toolName !== 'query_calendar_events' ||
        lookup.outcome.kind !== 'success' ||
        lookup.outcome.result.toolName !== 'query_calendar_events' ||
        lookup.outcome.result.mode !== 'list'
      ) {
        throw new Error('Scenario 008 requires catalogued list lookups');
      }
      const requiredQueryTerms = lookup.argumentCatalog.query.split(/\s+/u);
      for (const event of lookup.outcome.result.events) {
        const searchableContent = [event.summary, event.description, event.location]
          .filter((value): value is string => typeof value === 'string')
          .join(' ')
          .toLocaleLowerCase('en-US');
        expect(
          requiredQueryTerms.every((term) =>
            searchableContent.includes(term.toLocaleLowerCase('en-US'))
          )
        ).toBe(true);
      }
    }
    expect(
      weeklyLookup.outcome.result.events.filter(({ summary }) => summary.includes('Photos'))
    ).toHaveLength(4);
    const expectedPhotosEvents = expectedPhotosTitles
      .map((title, index) => ({
        day: 13 + index,
        title,
      }))
      .map(({ day, title }, index) => ({
        eventId: `mock_event_INTEX-EVAL-008_INTEX-EVAL-008-F01_photos_${String(index + 1)}`,
        etag: `"mock_event_INTEX-EVAL-008_INTEX-EVAL-008-F01_photos_${String(index + 1)}_v1"`,
        summary: title,
        description: 'Synthetic fixture INTEX-EVAL-008 INTEX-EVAL-008-F01',
        start: { date: `2026-08-${String(day).padStart(2, '0')}` },
        end: { date: `2026-08-${String(day + 1).padStart(2, '0')}` },
        calendarId: 'primary',
      }));
    expect(photosLookup.outcome.result.events).toEqual(expectedPhotosEvents);
    expect(
      weeklyLookup.outcome.result.events.filter(({ summary }) => summary.includes('Photos'))
    ).toEqual(expectedPhotosEvents);

    const updates = entry.mockProfile.calls.filter(
      ({ toolName }) => toolName === 'update_calendar_event'
    );
    expect(updates).toHaveLength(4);
    expect(
      updates.map((call) => {
        if (
          call.outcome.kind !== 'success' ||
          call.outcome.result.toolName !== 'update_calendar_event'
        ) {
          return null;
        }

        return {
          ordinal: call.ordinal,
          eventId: call.outcome.result.eventId,
          summary: call.outcome.result.summary,
          attendeesAdded: call.outcome.result.attendeesAdded,
          changes: call.outcome.result.changes,
        };
      })
    ).toEqual(
      [1, 2, 3, 4].map((ordinal) => ({
        ordinal,
        eventId: `mock_event_INTEX-EVAL-008_INTEX-EVAL-008-F01_photos_${String(ordinal)}`,
        summary: expectedPhotosTitles[ordinal - 1] ?? 'missing title',
        attendeesAdded: undefined,
        changes: {
          start: { date: `2026-08-${String(21 + ordinal).padStart(2, '0')}` },
          end: { date: `2026-08-${String(22 + ordinal).padStart(2, '0')}` },
        },
      }))
    );
  });
});
