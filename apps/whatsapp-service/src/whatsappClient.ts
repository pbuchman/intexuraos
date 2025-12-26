/**
 * WhatsApp Graph API client for sending messages and downloading media.
 * Implements the WhatsApp Business Cloud API for outbound messaging and media retrieval.
 */

import { getErrorMessage } from '@intexuraos/common';

const MEDIA_DOWNLOAD_TIMEOUT_MS = 30000;

/**
 * Response from WhatsApp media URL endpoint.
 */
export interface MediaUrlResponse {
  /**
   * URL to download the media file.
   */
  url: string;

  /**
   * MIME type of the media.
   */
  mime_type: string;

  /**
   * SHA256 hash of the media file.
   */
  sha256: string;

  /**
   * Size of the media file in bytes.
   */
  file_size: number;
}

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
    return {
      success: false,
      error: `Failed to send WhatsApp message: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * Get the download URL for a WhatsApp media file.
 *
 * @param mediaId - The WhatsApp media ID
 * @param accessToken - WhatsApp access token for authentication
 * @returns Media URL response with download URL and metadata
 */
export async function getMediaUrl(
  mediaId: string,
  accessToken: string
): Promise<{ success: boolean; data?: MediaUrlResponse; error?: string }> {
  const url = `https://graph.facebook.com/v21.0/${mediaId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        success: false,
        error: `WhatsApp API error: ${String(response.status)} - ${errorBody}`,
      };
    }

    const data = (await response.json()) as MediaUrlResponse;

    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get media URL: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * Download media content from WhatsApp.
 *
 * @param mediaUrl - The URL returned from getMediaUrl
 * @param accessToken - WhatsApp access token for authentication
 * @returns Buffer containing the media content
 */
export async function downloadMedia(
  mediaUrl: string,
  accessToken: string
): Promise<{ success: boolean; buffer?: Buffer; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, MEDIA_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        success: false,
        error: `Media download error: ${String(response.status)} - ${errorBody}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      success: true,
      buffer,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: `Media download timed out after ${String(MEDIA_DOWNLOAD_TIMEOUT_MS)}ms`,
      };
    }

    return {
      success: false,
      error: `Failed to download media: ${getErrorMessage(error)}`,
    };
  }
}
