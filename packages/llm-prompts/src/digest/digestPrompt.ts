import type { PromptBuilder } from '../shared/types.js';
import { COLD_START_EXAMPLE, WITH_CONTEXT_EXAMPLE } from './examples.js';

export const DIGEST_PROMPT_VERSION = '4.0.0';

const COLD_START_JSON = JSON.stringify(COLD_START_EXAMPLE, null, 2);
const WITH_CONTEXT_JSON = JSON.stringify(WITH_CONTEXT_EXAMPLE, null, 2);

export interface DigestPromptInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string;
  readonly outputLanguage: string;
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
  version: '4.0.0',

  build(input: DigestPromptInput): string {
    const targetLanguage = input.outputLanguage.trim();
    const messagesText = input.todaysMessages
      .map((m) => {
        const ts = new Date(m.postTimeSec * 1000).toISOString().slice(11, 16);
        return `[${ts}] ${m.sender}: ${m.text}`;
      })
      .join('\n');

    const stateJson = JSON.stringify(input.previousState ?? {}, null, 2);
    const summariesJson = JSON.stringify(input.last3Summaries, null, 2);

    return `You aggregate one day of messages from a fishing WhatsApp group into AggregationOutput JSON.

Target output language: ${targetLanguage}

Content format:
- headline: ONE short sentence (up to 200 characters) in the target output language that captures the most important topics of the day. Do not use generic templates like "The day was marked by...".
- bullets: 3 to 7 short bullets in the target output language. Each bullet is a concrete fact from today's messages: who, what, decision, or outcome. Do not duplicate thread, moderatorPosts, or openQuestions content; use the highest-signal facts of the day in note-headline style.
- Do not use the narrative field; leave it empty or omit it.

Language rules:
- Write every human-readable text value in the target output language: dailySummary.headline, dailySummary.bullets[], dailySummary.threads[].keyFacts[], dailySummary.moderatorPosts[].summary, dailySummary.openQuestions[], dailySummary.activityOutliers[].note, stateUpdate.identityLedger[].notes, stateUpdate.moderatorEvents[].summary, and stateUpdate.openThreads[].lastSignal.
- Use stable kebab-case topic identifiers for dailySummary.threads[].topic, dailySummary.moderatorPosts[].topic, stateUpdate.moderatorEvents[].topic, and stateUpdate.openThreads[].topic. If continuing an existing open thread, keep the existing topic identifier unchanged.
- If previousState or last3Summaries contain another language, translate or normalize any carried-forward human-readable facts into the target output language instead of copying them.
- The example JSON below demonstrates schema shape and reasoning only. Its wording does not override the target output language.
- Keep enum keys, kebab-case thread identifiers, groupKey values, and YYYY-MM-DD dates in their schema format.
- Preserve participant names and source group names as written in the input.
- DO NOT COPY text verbatim from previousState or last3Summaries. Those values are historical context only; they describe previous days, not today. If nothing happened in a thread today, omit it.
- Return ONE JSON object with { dailySummary, stateUpdate } that matches the Zod schema.
- recentSummaryDates: append today's date and trim to the last 30 days.
- identityLedger: increment counters for senders visible today; add new senders with role='newcomer'; preserve everyone else unchanged.
- moderatorEvents: append only; never remove entries.
- openThreads: carry forward with updated lastSignal/lastSignalDate; remove only when today's messages clearly close the topic.
- Do not invent information; use empty arrays when facts are missing.
- The result MUST be valid JSON: no markdown blocks, comments, or trailing commas.

Example 1 (cold start, empty state):
${COLD_START_JSON}

Example 2 (state + 3-day window):
${WITH_CONTEXT_JSON}

Input data for the current run:

userId: ${input.userId}
groupKey: ${input.groupKey}
date: ${input.date}

previousState (or {} for cold start) - CONTEXT ONLY:
${stateJson}

last3Summaries (previous days; CONTEXT ONLY, DO NOT COPY):
${summariesJson}

todaysMessages (deduplicated, sorted ascending by time) - THE ONLY SOURCE OF FACTS:
${messagesText}

Return only the AggregationOutput JSON object.`;
  },
};
