/**
 * WhatsApp Graph API client for sending messages.
 * Implements the WhatsApp Business Cloud API for outbound messaging.
 */

/**
 * Send a text message via WhatsApp Graph API.
 *
 * @param phoneNumberId - The WhatsApp Business phone number ID to send from
 * @param recipientPhone - The recipient's phone number (E.164 format)
 * @param messageText - The text message to send
 * @param accessToken - WhatsApp access token for authentication
 * @param contextMessageId - Optional: ID of message to reply to (creates a reply)
 * @returns Response from Graph API containing message ID
 */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  recipientPhone: string,
  messageText: string,
  accessToken: string,
  contextMessageId?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  const payload: {
    messaging_product: string;
    to: string;
    type: string;
    text: { body: string };
    context?: { message_id: string };
  } = {
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: 'text',
    text: { body: messageText },
  };

  // Add context if replying to a message
  if (contextMessageId !== undefined) {
    payload.context = { message_id: contextMessageId };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        success: false,
        error: `WhatsApp API error: ${String(response.status)} - ${errorBody}`,
      };
    }

    const data = (await response.json()) as {
      messaging_product: string;
      contacts: { input: string; wa_id: string }[];
      messages: { id: string }[];
    };

    const messageId = data.messages[0]?.id;

    return {
      success: true,
      ...(messageId !== undefined && { messageId }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Failed to send WhatsApp message: ${message}`,
    };
  }
}
