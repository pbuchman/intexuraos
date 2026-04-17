import { COLD_START_EXAMPLE, WITH_CONTEXT_EXAMPLE } from './examples.js';

export const DIGEST_PROMPT_VERSION = '1.0.0';

export interface DigestPromptInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string; // YYYY-MM-DD
  readonly previousState: unknown; // GroupState or null on cold start
  readonly last3Summaries: readonly unknown[]; // DailySummary[]
  readonly todaysMessages: readonly {
    readonly sender: string;
    readonly text: string;
    readonly postTimeSec: number;
  }[];
}

export function buildDigestPrompt(input: DigestPromptInput): string {
  const messagesText = input.todaysMessages
    .map((m) => {
      const ts = new Date(m.postTimeSec * 1000).toISOString().slice(11, 16);
      return `[${ts}] ${m.sender}: ${m.text}`;
    })
    .join('\n');

  const stateJson = JSON.stringify(input.previousState ?? {}, null, 2);
  const summariesJson = JSON.stringify(input.last3Summaries, null, 2);

  return `Jesteś asystentem agregującym dzień rozmów z grupy WhatsApp wędkarskiej w schemat AggregationOutput (JSON).

Wymagania:
- Cała narracja, opisy wątków, notatki, podsumowania moderatorskie i pytania otwarte muszą być po polsku.
- Klucze enum, identyfikatory wątków (kebab-case), groupKey i daty (YYYY-MM-DD) – po angielsku.
- Wynikiem jest JEDEN obiekt JSON o polach { dailySummary, stateUpdate } pasujący do schematu Zod.
- recentSummaryDates: dopisz dzisiejszą datę, przytnij do ostatnich 30 dni.
- identityLedger: zwiększaj liczniki dla nadawców widocznych dzisiaj; dodawaj nowych z role='newcomer'; pozostałych zachowaj bez zmian.
- moderatorEvents: tylko append (nigdy nie usuwaj).
- openThreads: przenoś z aktualizacją lastSignal/lastSignalDate; usuwaj wyłącznie gdy dzisiejsze wiadomości jednoznacznie zamykają temat.
- Nie wymyślaj informacji – jeżeli czegoś brakuje, użyj pustej tablicy.
- Wynik MUSI być prawidłowym JSON-em (bez bloków markdown, bez komentarzy, bez końcowych przecinków).

Przykład 1 (cold start, pusty stan):
${JSON.stringify(COLD_START_EXAMPLE, null, 2)}

Przykład 2 (stan + 3-dniowe okno):
${JSON.stringify(WITH_CONTEXT_EXAMPLE, null, 2)}

Dane wejściowe dla bieżącego uruchomienia:

userId: ${input.userId}
groupKey: ${input.groupKey}
date: ${input.date}

previousState (lub {} dla cold start):
${stateJson}

last3Summaries (chronologicznie, najstarsza pierwsza):
${summariesJson}

todaysMessages (po dedup, posortowane rosnąco po czasie):
${messagesText}

Zwróć wyłącznie obiekt JSON AggregationOutput.`;
}
// Prompt version: 1.0.0
