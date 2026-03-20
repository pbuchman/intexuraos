import type { PromptBuilder } from '@intexuraos/llm-prompts';
import type { MaterializedBufferState } from '../domain/models/materializedBufferState.js';

export interface GenerateDraftPromptInput {
  state: MaterializedBufferState;
  priorDraft: string | null;
  requestText: string;
}

export const generateDraftPrompt: PromptBuilder<GenerateDraftPromptInput> = {
  name: 'generate-draft',
  description: 'Generates a markdown draft from the materialized buffer state',
  version: '1.0.0',

  build(input: GenerateDraftPromptInput): string {
    const thoughtList =
      input.state.thoughts.length > 0
        ? input.state.thoughts.map((t) => `- ${t.text}`).join('\n')
        : '(no thoughts yet)';

    const sampleSection =
      input.state.writingSamples.length > 0
        ? `\nWRITING SAMPLES (match this style):\n${input.state.writingSamples.map((s) => `---\n${s}\n---`).join('\n')}`
        : '';

    const styleSection =
      input.state.styleInstructions !== null
        ? `\nSTYLE INSTRUCTIONS: ${input.state.styleInstructions}`
        : '';

    const audienceSection =
      input.state.audience !== null ? `\nTARGET AUDIENCE: ${input.state.audience}` : '';

    const goalSection =
      input.state.contentGoal !== null ? `\nCONTENT GOAL: ${input.state.contentGoal}` : '';

    const priorDraftSection =
      input.priorDraft !== null
        ? `\nPRIOR DRAFT (improve upon this):\n${input.priorDraft}`
        : '';

    return `You are a skilled writer. Generate a well-structured markdown document based on the following inputs.

THOUGHTS/IDEAS TO INCORPORATE:
${thoughtList}
${sampleSection}${styleSection}${audienceSection}${goalSection}${priorDraftSection}

USER REQUEST: ${input.requestText}

Generate the draft as clean markdown. Do not include any meta-commentary or explanations outside the document itself.`;
  },
};
