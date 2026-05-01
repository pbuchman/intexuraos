import type { PromptBuilder } from '../shared/types.js';
import { COLD_START_EXAMPLE, WITH_CONTEXT_EXAMPLE } from './examples.js';

export const DIGEST_PROMPT_VERSION = '2.0.0';

const COLD_START_JSON = JSON.stringify(COLD_START_EXAMPLE, null, 2);
const WITH_CONTEXT_JSON = JSON.stringify(WITH_CONTEXT_EXAMPLE, null, 2);

export interface DigestPromptInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string;
  readonly previousState: unknown;
  readonly last3Summaries: readonly unknown[];
  readonly todaysMessages: readonly {
    readonly sender: string;
    readonly text: string;
    readonly postTimeSec: number;
  }[];
}

export const digestPrompt: PromptBuilder<DigestPromptInput> = {
  name: 'whatsapp-digest',
  description: 'Aggregates a day of WhatsApp fishing-group messages into AggregationOutput JSON',
  version: '2.0.0',

  build(input: DigestPromptInput): string {
    const messagesText = input.todaysMessages
      .map((m) => {
        const ts = new Date(m.postTimeSec * 1000).toISOString().slice(11, 16);
        return `[${ts}] ${m.sender}: ${m.text}`;
      })
      .join('\n');

    const stateJson = JSON.stringify(input.previousState ?? {}, null, 2);
    const summariesJson = JSON.stringify(input.last3Summaries, null, 2);

    return `Jesteś asystentem agregującym dzień rozmów z grupy WhatsApp wędkarskiej w schemat AggregationOutput (JSON).

Format treści:
- headline: JEDNO krótkie zdanie (do 200 znaków) po polsku, oddające najważniejsze tematy dnia. Nie stosuj szablonów typu "Dzień upłynął pod znakiem…".
- bullets: 3 do 7 krótkich wypunktowań po polsku. Każde jest konkretnym faktem z dzisiejszych wiadomości (kto, co, decyzja, skutek). Nie dublują się z treścią threads, moderatorPosts czy openQuestions — są najbardziej istotnymi faktami dnia w stylu "nagłówków notatki".
- Nie używaj pola narrative — pozostaw je puste lub pomiń.

Zasady treści:
- Cała narracja, opisy wątków, notatki, podsumowania moderatorskie i pytania otwarte muszą być po polsku.
- Klucze enum, identyfikatory wątków (kebab-case), groupKey i daty (YYYY-MM-DD) – po angielsku.
- NIE KOPIUJ dosłownie tekstu z previousState ani z last3Summaries. Te dane są wyłącznie kontekstem historycznym — opisują poprzednie dni, a nie dzisiejszy. Jeśli dzisiaj nie wydarzyło się nic w danym wątku, pomiń go.
- Wynikiem jest JEDEN obiekt JSON o polach { dailySummary, stateUpdate } pasujący do schematu Zod.
- recentSummaryDates: dopisz dzisiejszą datę, przytnij do ostatnich 30 dni.
- identityLedger: zwiększaj liczniki dla nadawców widocznych dzisiaj; dodawaj nowych z role='newcomer'; pozostałych zachowaj bez zmian.
- moderatorEvents: tylko append (nigdy nie usuwaj).
- openThreads: przenoś z aktualizacją lastSignal/lastSignalDate; usuwaj wyłącznie gdy dzisiejsze wiadomości jednoznacznie zamykają temat.
- Nie wymyślaj informacji – jeżeli czegoś brakuje, użyj pustej tablicy.
- Wynik MUSI być prawidłowym JSON-em (bez bloków markdown, bez komentarzy, bez końcowych przecinków).

Przykład 1 (cold start, pusty stan):
${COLD_START_JSON}

Przykład 2 (stan + 3-dniowe okno):
${WITH_CONTEXT_JSON}

Dane wejściowe dla bieżącego uruchomienia:

userId: ${input.userId}
groupKey: ${input.groupKey}
date: ${input.date}

previousState (lub {} dla cold start) — KONTEKST TYLKO:
${stateJson}

last3Summaries (poprzednie dni; KONTEKST TYLKO, NIE KOPIUJ):
${summariesJson}

todaysMessages (po dedup, posortowane rosnąco po czasie) — JEDYNE ŹRÓDŁO FAKTÓW:
${messagesText}

Zwróć wyłącznie obiekt JSON AggregationOutput.`;
  },
};
