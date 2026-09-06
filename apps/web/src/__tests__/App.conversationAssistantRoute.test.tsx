import { describe, expect, it } from 'vitest';
// @ts-expect-error vite raw import has no type declaration
import src from '../App.tsx?raw'; // @allow-missing-js -- vite '?raw' query import

describe('App.tsx conversation assistant route registration', () => {
  const source = src as string;

  it('registers separate list, creation, and conversation routes', () => {
    expect(source).toContain('WhatsAppConversationAssistantListPage');
    expect(source).toContain('WhatsAppConversationAssistantNewPage');
    expect(source).toContain('WhatsAppConversationAssistantSessionPage');
    expect(source).toContain('path="/whatsapp/conversation-assistant"');
    expect(source).toMatch(
      /path="\/whatsapp\/conversation-assistant"\s+element={<WhatsAppConversationAssistantListPage \/>}/
    );
    expect(source).toMatch(
      /path="\/whatsapp\/conversation-assistant\/new"\s+element={<WhatsAppConversationAssistantNewPage \/>}/
    );
    expect(source).toMatch(
      /path="\/whatsapp\/conversation-assistant\/:sessionId"\s+element={<WhatsAppConversationAssistantSessionPage \/>}/
    );
  });
});
