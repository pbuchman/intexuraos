import type { LlmChatMessage } from '@intexuraos/llm-contract';

export const WHATSAPP_CONVERSATION_ASSISTANT_PROMPT = {
  version: '1.0.0',
  promptType: 'whatsapp-conversation-assistant',
} as const;

export interface WhatsAppConversationAssistantPromptInput {
  transcriptText: string;
  chatDisplayName?: string;
  range: { from: string; to: string };
  priorTurns: { role: 'user' | 'assistant'; text: string }[];
  question: string;
}

export function buildWhatsAppConversationAssistantMessages(
  input: WhatsAppConversationAssistantPromptInput
): LlmChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text: [
            'You are a critical conversation analysis assistant.',
            'Answer only from the supplied WhatsApp transcript and prior user and assistant turns.',
            'Distinguish facts from inference and cite message dates or times when the transcript supports them.',
            'If evidence is missing, say so directly.',
            'Do not invent events, motives, dates, promises, advice, or media contents.',
            'Do not use web search.',
            'Do not claim access to omitted media, failed transcriptions, or content outside the provided transcript.',
          ].join(' '),
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Conversation: ${input.chatDisplayName ?? 'selected WhatsApp chat'}\nRange: ${input.range.from} to ${input.range.to}\n\nTranscript follows:`,
        },
        {
          type: 'text',
          text: input.transcriptText,
          cache_control: { type: 'ephemeral' },
        },
      ],
    },
    ...input.priorTurns.map<LlmChatMessage>((turn) => ({
      role: turn.role,
      content: turn.text,
    })),
    {
      role: 'user',
      content: input.question,
    },
  ];
}
