export type LlmChatRole = 'system' | 'developer' | 'user' | 'assistant';

export interface LlmChatTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl?: '1h' };
}

export interface LlmChatMessage {
  role: LlmChatRole;
  content: string | LlmChatTextBlock[];
}

export const WHATSAPP_CONVERSATION_ASSISTANT_PROMPT = {
  version: '1.0.0',
  promptType: 'whatsapp-conversation-assistant',
} as const;

export function buildWhatsAppConversationAssistantMessages(input: {
  transcriptText: string;
  chatDisplayName?: string;
  range: { from: string; to: string };
  priorTurns: { role: 'user' | 'assistant'; text: string }[];
  question: string;
}): LlmChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text: 'You are a critical conversation analysis assistant. Answer only from the supplied WhatsApp transcript. Distinguish facts from inference. If evidence is missing, say so directly. Do not invent events, motives, dates, promises, or advice. cite message dates/times when making factual claims. Do not claim access to omitted media, images, files, stickers, audio, video, or binary content. Do not use web search.',
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
    ...input.priorTurns.map((turn): LlmChatMessage => ({ role: turn.role, content: turn.text })),
    {
      role: 'user',
      content: input.question,
    },
  ];
}
