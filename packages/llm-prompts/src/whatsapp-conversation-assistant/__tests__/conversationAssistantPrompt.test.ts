import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppConversationAssistantMessages,
  WHATSAPP_CONVERSATION_ASSISTANT_PROMPT,
} from '../conversationAssistantPrompt.js';

describe('buildWhatsAppConversationAssistantMessages', () => {
  const input = {
    transcriptText: '2026-06-30T10:00:00.000Z You: hello\n2026-06-30T10:01:00.000Z Alex: hi',
    chatDisplayName: 'Alex',
    range: { from: '2026-06-30T10:00:00.000Z', to: '2026-06-30T11:00:00.000Z' },
    priorTurns: [
      { role: 'user' as const, text: 'What was agreed?' },
      { role: 'assistant' as const, text: 'The context does not show an agreement.' },
    ],
    question: 'What should I know?',
  };

  it('exposes semver prompt metadata at version 1.0.0', () => {
    expect(WHATSAPP_CONVERSATION_ASSISTANT_PROMPT).toEqual({
      version: '1.0.0',
      promptType: 'whatsapp-conversation-assistant',
    });
  });

  it('places the cached transcript block before prior turns and the current question', () => {
    const messages = buildWhatsAppConversationAssistantMessages(input);

    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages[1]?.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('Conversation: Alex') }),
      {
        type: 'text',
        text: input.transcriptText,
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(messages[2]).toEqual({ role: 'user', content: input.priorTurns[0]?.text });
    expect(messages[3]).toEqual({ role: 'assistant', content: input.priorTurns[1]?.text });
    expect(messages[4]).toEqual({ role: 'user', content: input.question });
  });

  it('sets cache_control only on the transcript block', () => {
    const messages = buildWhatsAppConversationAssistantMessages(input);
    const cacheControlledBlocks = messages.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.filter((block) => block.cache_control !== undefined)
        : []
    );

    expect(cacheControlledBlocks).toEqual([
      { type: 'text', text: input.transcriptText, cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('uses a generic conversation label when the chat display name is unavailable', () => {
    const { chatDisplayName: _chatDisplayName, ...withoutDisplayName } = input;
    const messages = buildWhatsAppConversationAssistantMessages(withoutDisplayName);

    expect(messages[1]?.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('selected WhatsApp chat') }),
      expect.objectContaining({ text: input.transcriptText }),
    ]);
  });

  it('instructs the assistant not to invent, to state missing evidence, to ignore omitted media, and not to use web search', () => {
    const messages = buildWhatsAppConversationAssistantMessages(input);
    const systemContent = messages[0]?.content;

    expect(systemContent).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('Do not invent'),
      }),
    ]);
    const text = Array.isArray(systemContent) ? systemContent[0]?.text : '';
    expect(text).toContain('If evidence is missing');
    expect(text).toContain('omitted media');
    expect(text).toContain('Do not use web search');
    expect(text).toContain('cite message dates/times');
  });
});
