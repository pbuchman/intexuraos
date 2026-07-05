import type { ConversationAssistantDateRange, LlmChatMessage } from '@intexuraos/llm-contract';

export const WHATSAPP_CONVERSATION_ASSISTANT_PROMPT = {
  version: '3.0.0',
  promptType: 'whatsapp-conversation-assistant',
} as const;

export interface WhatsAppConversationAssistantPromptInput {
  transcriptText: string;
  chatDisplayName?: string;
  range: ConversationAssistantDateRange;
  effectiveRange: ConversationAssistantDateRange;
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
            'Adapt your role and tone to the user need: you may reason like a psychologist, analyst, or lawyer when that framing is useful.',
            'Distinguish facts, inference, uncertainty, and missing evidence.',
            'When citing timing, cite only the day, month, and year, not exact times.',
            'Do not output raw ISO timestamps, bracketed timestamp IDs, or second-level timestamp citations.',
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
          text: [
            `Conversation: ${input.chatDisplayName ?? 'selected WhatsApp chat'}`,
            `Information range: ${formatPromptDateLabel(input.range.from)} to ${formatPromptDateLabel(input.range.to)}`,
            `Effective range: ${formatPromptDateLabel(input.effectiveRange.from)} to ${formatPromptDateLabel(input.effectiveRange.to)}`,
            '',
            'Transcript follows:',
          ].join('\n'),
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

const ENGLISH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function formatPromptDateLabel(value: string): string {
  const date = new Date(value);
  const month = ENGLISH_MONTHS[date.getUTCMonth()];
  if (month === undefined) {
    return 'Unknown date';
  }
  return `${String(date.getUTCDate())} ${month} ${String(date.getUTCFullYear())}`;
}
