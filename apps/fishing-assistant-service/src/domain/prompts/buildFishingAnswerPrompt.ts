import type { FishingChatMessage } from '../models/chat.js';
import type { EvidenceItem } from '../retrieval/types.js';

interface PromptBuilder<TInput> {
  name: string;
  description: string;
  version: string;
  build(input: TInput): string;
}

export interface BuildFishingAnswerPromptInput {
  question: string;
  recentMessages: FishingChatMessage[];
  evidence: EvidenceItem[];
}

export const fishingAnswerPrompt: PromptBuilder<BuildFishingAnswerPromptInput> = {
  name: 'fishing-assistant-answer',
  description: 'Builds a grounded JSON-answer prompt for Fishing Assistant chat responses',
  version: '1.0.0',

  build(input: BuildFishingAnswerPromptInput): string {
    const history = input.recentMessages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n');
    const evidenceBlocks = input.evidence
      .map(
        (item) =>
          `[${item.id}] (${item.sourceType}) ${item.title}${item.date !== undefined ? ` ${item.date}` : ''}\n${item.text}`
      )
      .join('\n\n');

    return [
      'Answer the fishing question using only the evidence below.',
      'Return strict JSON with shape {"answerMarkdown": string, "citations": [{"sourceId": string, "usedFor": string}], "confidence": "high"|"medium"|"low"}.',
      history !== '' ? `Conversation history:\n${history}` : '',
      `Question:\n${input.question}`,
      `Evidence:\n${evidenceBlocks}`,
    ]
      .filter((part) => part !== '')
      .join('\n\n');
  },
};
