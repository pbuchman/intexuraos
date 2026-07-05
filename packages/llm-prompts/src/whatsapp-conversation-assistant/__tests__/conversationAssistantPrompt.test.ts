import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppConversationAssistantMessages,
  WHATSAPP_CONVERSATION_ASSISTANT_PROMPT,
} from '../conversationAssistantPrompt.js';

describe('WHATSAPP_CONVERSATION_ASSISTANT_PROMPT', () => {
  it('has the exact metadata required by the contract', () => {
    expect(WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.version).toBe('3.0.0');
    expect(WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.promptType).toBe(
      'whatsapp-conversation-assistant'
    );
  });
});

describe('buildWhatsAppConversationAssistantMessages', () => {
  it('builds a stable cached transcript block before prior turns and the current question', () => {
    const messages = buildWhatsAppConversationAssistantMessages({
      transcriptText: '[1 June] You: Hello',
      chatDisplayName: 'Taylor',
      range: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
      effectiveRange: {
        from: '2026-06-01T10:00:00.000Z',
        to: '2026-06-01T11:00:00.000Z',
      },
      priorTurns: [
        { role: 'user', text: 'Summarize the conversation.' },
        { role: 'assistant', text: 'You discussed travel plans.' },
      ],
      question: 'Did Taylor confirm the date?',
    });

    expect(messages).toHaveLength(5);

    const systemMessage = messages[0];
    expect(systemMessage).toEqual(
      expect.objectContaining({
        role: 'system',
      })
    );

    const cachedMessage = messages[1];
    expect(cachedMessage).toEqual(
      expect.objectContaining({
        role: 'user',
      })
    );
    expect(cachedMessage?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Conversation: Taylor'),
      }),
      {
        type: 'text',
        text: '[1 June] You: Hello',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(JSON.stringify(messages)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(messages)).toContain('Information range: 1 June 2026 to 2 June 2026');
    expect(JSON.stringify(messages)).toContain('Effective range: 1 June 2026 to 1 June 2026');

    expect(messages[2]).toEqual({ role: 'user', content: 'Summarize the conversation.' });
    expect(messages[3]).toEqual({ role: 'assistant', content: 'You discussed travel plans.' });
    expect(messages[4]).toEqual({ role: 'user', content: 'Did Taylor confirm the date?' });
  });

  it('appends the current question after the cached transcript block and prior turns', () => {
    const messages = buildWhatsAppConversationAssistantMessages({
      transcriptText: 'Transcript',
      range: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
      effectiveRange: {
        from: '2026-06-01T10:00:00.000Z',
        to: '2026-06-01T11:00:00.000Z',
      },
      priorTurns: [{ role: 'assistant', text: 'Earlier answer' }],
      question: 'What is missing?',
    });

    expect(messages.at(-1)).toEqual({ role: 'user', content: 'What is missing?' });
  });

  it('uses a stable fallback label for invalid range dates', () => {
    const messages = buildWhatsAppConversationAssistantMessages({
      transcriptText: 'Transcript',
      range: { from: 'not-a-date', to: '2026-06-02T00:00:00.000Z' },
      effectiveRange: {
        from: 'not-a-date',
        to: '2026-06-01T11:00:00.000Z',
      },
      priorTurns: [],
      question: 'What happened?',
    });

    expect(JSON.stringify(messages)).toContain('Information range: Unknown date to 2 June 2026');
    expect(JSON.stringify(messages)).toContain('Effective range: Unknown date to 1 June 2026');
    expect(JSON.stringify(messages)).not.toContain('NaN');
  });

  it('adds cache_control only to the transcript block', () => {
    const messages = buildWhatsAppConversationAssistantMessages({
      transcriptText: 'Transcript',
      range: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
      effectiveRange: {
        from: '2026-06-01T10:00:00.000Z',
        to: '2026-06-01T11:00:00.000Z',
      },
      priorTurns: [],
      question: 'What happened?',
    });

    const textBlocks = messages.flatMap((message) =>
      Array.isArray(message.content) ? message.content : []
    );

    expect(textBlocks.filter((block) => 'cache_control' in block)).toEqual([
      {
        type: 'text',
        text: 'Transcript',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('includes system instructions for role adaptation, missing evidence, timestamp limits, and omitted media limits', () => {
    const messages = buildWhatsAppConversationAssistantMessages({
      transcriptText: 'Transcript',
      range: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
      effectiveRange: {
        from: '2026-06-01T10:00:00.000Z',
        to: '2026-06-01T11:00:00.000Z',
      },
      priorTurns: [],
      question: 'What happened?',
    });

    const systemContent = messages[0]?.content;
    expect(Array.isArray(systemContent)).toBe(true);
    if (Array.isArray(systemContent)) {
      const combinedText = systemContent.map((block) => block.text).join('\n');
      expect(combinedText).toContain('prior user and assistant turns');
      expect(combinedText).toContain('psychologist');
      expect(combinedText).toContain('analyst');
      expect(combinedText).toContain('lawyer');
      expect(combinedText).toContain('If evidence is missing');
      expect(combinedText).toContain('Do not output raw ISO timestamps');
      expect(combinedText).toContain('day, month, and year');
      expect(combinedText).toContain('Do not invent');
      expect(combinedText).toContain('Do not use web search');
      expect(combinedText).toContain('Do not claim access to omitted media');
    }
  });
});
