import type { PromptBuilder } from '@intexuraos/llm-prompts';
import type { MaterializedBufferState } from '../domain/models/materializedBufferState.js';

export interface InterpretImposePromptInput {
  utterance: string;
  currentState: MaterializedBufferState;
}

export const interpretImposePrompt: PromptBuilder<InterpretImposePromptInput> = {
  name: 'interpret-impose',
  description:
    'Interprets a user utterance into a structured intent for the hellscript buffer system',
  version: '1.0.0',

  build(input: InterpretImposePromptInput): string {
    const thoughtList =
      input.currentState.thoughts.length > 0
        ? input.currentState.thoughts
            .map((t) => `  - [${t.id}] "${t.text}"`)
            .join('\n')
        : '  (none)';

    const sampleList =
      input.currentState.writingSamples.length > 0
        ? input.currentState.writingSamples.map((s) => `  - "${s}"`).join('\n')
        : '  (none)';

    return `You are a writing assistant that interprets user utterances into structured intents.

Given the user's utterance and the current buffer state, determine which action the user wants to take.

CURRENT BUFFER STATE:
Thoughts:
${thoughtList}
Writing samples:
${sampleList}
Style instructions: ${input.currentState.styleInstructions ?? '(none)'}
Audience: ${input.currentState.audience ?? '(none)'}
Content goal: ${input.currentState.contentGoal ?? '(none)'}

AVAILABLE INTENTS:
- append_thought: User wants to add a new thought/idea. Payload: { "text": "..." }
- add_writing_sample: User provides a writing sample. Payload: { "text": "..." }
- set_style_instructions: User specifies writing style. Payload: { "instructions": "..." }
- set_metadata: User sets audience or content goal. Payload: { "audience"?: "...", "contentGoal"?: "..." }
- delete_thought: User wants to remove a thought. Payload: { "thoughtId": "..." }
- reorder_thoughts: User wants to reorder thoughts. Payload: { "thoughtIds": ["id1", "id2", ...] }
- update_draft: User wants to generate/update the draft. Payload: { "text": "..." }
- fallback_append: When intent is unclear, treat as a new thought. Payload: { "text": "..." }

USER UTTERANCE:
"${input.utterance}"

Respond with ONLY valid JSON matching this schema:
{
  "kind": "<intent_kind>",
  "payload": { ... },
  "fallbackReason": "<optional: reason if using fallback_append>"
}`;
  },
};
