import { describe, expect, it } from 'vitest';
// @ts-expect-error vite raw import has no type declaration
import src from '../App.tsx?raw'; // @allow-missing-js -- vite '?raw' query import

describe('App.tsx conversation assistant route registration', () => {
  const source = src as string;

  it('registers the WhatsApp conversation assistant page at /whatsapp/conversation-assistant', () => {
    expect(source).toContain('WhatsAppConversationAssistantPage');
    expect(source).toContain('path="/whatsapp/conversation-assistant"');
    expect(source).toMatch(
      /path="\/whatsapp\/conversation-assistant"\s+element={<WhatsAppConversationAssistantPage \/>}/
    );
  });
});
