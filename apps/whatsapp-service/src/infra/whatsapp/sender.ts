/**
 * WhatsApp Cloud API Message Sender.
 * Sends messages using the WhatsApp Business Cloud API.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import { performHttpFetch } from '@intexuraos/common-http';
import { WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH } from '@intexuraos/http-contracts';
import { createAppLogger, SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import type {
  WhatsAppInteractiveButton,
  WhatsAppMessageDigestTemplate,
  WhatsAppMessageSender,
} from '../../domain/whatsapp/index.js';
import { WHATSAPP_MESSAGE_SEND_TIMEOUT_MS } from '../../domain/whatsapp/ports/messageSender.js';
import type { WhatsAppError } from '../../domain/whatsapp/models/error.js';

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v22.0';
const MAX_TEXT_BODY_LENGTH = 4096;
const MESSAGE_DIGEST_TEMPLATE_V1_NAME = 'intexuraos_message_digest_v1';
const MESSAGE_DIGEST_TEMPLATE_V1_LANGUAGE = 'en_US';
const MESSAGE_DIGEST_TEMPLATE_V2_NAME = 'intexuraos_message_digest_v4';
const MESSAGE_DIGEST_TEMPLATE_V2_LANGUAGE = 'pl';
const MESSAGE_DIGEST_EMPTY_SECTION = '—';
const MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS = 1_024;
const MESSAGE_DIGEST_TEMPLATE_V2_FIXED_BODY_CODE_POINTS = 146;

const logger = createAppLogger({ name: 'whatsapp-sender' });

type WhatsAppMessageBody =
  | { type: 'text'; text: { preview_url: boolean; body: string } }
  | {
      type: 'interactive';
      interactive:
        | { type: 'button'; body: { text: string }; action: { buttons: { type: string; reply: { id: string; title: string } }[] } }
        | { type: 'cta_url'; body: { text: string }; action: { name: 'cta_url'; parameters: { display_text: string; url: string } } };
    }
  | {
      type: 'template';
      template: {
        name: string;
        language: { code: string };
        components: [
          {
            type: 'body';
            parameters: { type: 'text'; text: string }[];
          },
          {
            type: 'button';
            sub_type: 'url';
            index: '0';
            parameters: [{ type: 'text'; text: string }];
          },
        ];
      };
    };

type MessageTypeLabel = 'text' | 'interactive' | 'CTA URL' | 'Message Digest template';

interface ProviderErrorMetadata {
  providerCode?: number;
  providerSubcode?: number;
}

interface CompactMessageDigestSection {
  content: string;
  isQuestion: boolean;
  isStandalone: boolean;
}

function compactMessageDigestSections(
  digestBody: string,
  fixedParameters: readonly string[]
): [string, string, string] {
  const sections = digestBody
    .split(/\n{2,}/u)
    .map((section) => {
      const lines = section
        .split(/\n+/u)
        .map((line) => line.replace(/\s+/gu, ' ').trim())
        .filter((line) => line !== '');
      const title = lines[0] ?? '';
      const items = lines.slice(1);
      return {
        content: items.length === 0 ? title : items.join(' • '),
        isQuestion: isFollowUpSection(title),
        isStandalone: items.length === 0,
      } satisfies CompactMessageDigestSection;
    })
    .filter((section) => section.content !== '')
    .slice(0, 3);

  const slots: [string, string, string] = ['', '', ''];
  const firstSection = sections[0];
  let lastUsedSlot: 0 | 1 | 2 = 0;
  if (firstSection !== undefined) slots[0] = firstSection.content;
  for (const section of sections.slice(1)) {
    const targetSlot: 0 | 1 | 2 = section.isStandalone
      ? lastUsedSlot
      : section.isQuestion
        ? 2
        : 1;
    slots[targetSlot] =
      slots[targetSlot] === ''
        ? section.content
        : `${slots[targetSlot]} • ${section.content}`;
    lastUsedSlot = targetSlot;
  }

  const padded: [string, string, string] = [
    slots[0] === '' ? MESSAGE_DIGEST_EMPTY_SECTION : slots[0],
    slots[1] === '' ? MESSAGE_DIGEST_EMPTY_SECTION : slots[1],
    slots[2] === '' ? MESSAGE_DIGEST_EMPTY_SECTION : slots[2],
  ];
  const sectionBudget = Math.max(
    3,
    MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS -
      MESSAGE_DIGEST_TEMPLATE_V2_FIXED_BODY_CODE_POINTS -
      fixedParameters.reduce((total, value) => total + codePointLength(value), 0)
  );
  let overflow =
    padded.reduce((total, section) => total + codePointLength(section), 0) - sectionBudget;
  for (const index of [2, 1, 0] as const) {
    if (overflow <= 0) break;
    const currentLength = codePointLength(padded[index]);
    const targetLength = Math.max(2, currentLength - overflow);
    padded[index] = truncateCodePoints(padded[index], targetLength);
    overflow -= currentLength - codePointLength(padded[index]);
  }

  return padded;
}

function isFollowUpSection(title: string): boolean {
  if (title.startsWith('❓')) return true;
  const normalizedTitle = title.toLocaleUpperCase('pl-PL');
  return [
    'CO DALEJ',
    'NASTĘPN',
    'DALSZY KROK',
    'DALSZE KROKI',
    'OTWARTE PYTAN',
    'DO ZROBIENIA',
    'DO WYKONANIA',
    'WYMAGA DZIAŁANIA',
    'NEXT STEP',
    'NEXT STEPS',
    'FOLLOW-UP',
    'FOLLOW UP',
  ].some((marker) => normalizedTitle.includes(marker));
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function truncateCodePoints(value: string, maxCodePoints: number): string {
  if (codePointLength(value) <= maxCodePoints) return value;
  return `${Array.from(value).slice(0, maxCodePoints - 1).join('').trimEnd()}…`;
}

function truncateBody(message: string, maxLength: number, messageType: MessageTypeLabel, phoneNumber: string): string {
  if (message.length <= maxLength) {
    return message;
  }
  logger.warn(
    {
      recipientHint: getRecipientLogHint(phoneNumber),
      originalLength: message.length,
      maxLength,
      [SKIP_SENTRY_KEY]: true,
    },
    `Truncated ${messageType} message body to fit WhatsApp limit`
  );
  return message.substring(0, maxLength);
}

/**
 * WhatsApp Cloud API implementation of message sender.
 */
export class WhatsAppCloudApiSender implements WhatsAppMessageSender {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;

  constructor(accessToken: string, phoneNumberId: string) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
  }

  async sendTextMessage(
    phoneNumber: string,
    message: string
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    const truncatedMessage = truncateBody(message, MAX_TEXT_BODY_LENGTH, 'text', phoneNumber);
    return await this.sendRequest(phoneNumber, {
      type: 'text',
      text: { preview_url: false, body: truncatedMessage },
    }, 'text');
  }

  async sendInteractiveMessage(
    phoneNumber: string,
    message: string,
    buttons: WhatsAppInteractiveButton[]
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    // WhatsApp limits button titles to 20 characters
    const truncatedButtons = buttons.map((btn) => ({
      type: btn.type,
      reply: {
        id: btn.reply.id,
        title: btn.reply.title.length > 20 ? btn.reply.title.substring(0, 20) : btn.reply.title,
      },
    }));

    const truncatedMessage = truncateBody(
      message,
      WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH,
      'interactive',
      phoneNumber
    );

    const interactiveBody = {
      type: 'interactive' as const,
      interactive: {
        type: 'button' as const,
        body: { text: truncatedMessage },
        action: { buttons: truncatedButtons },
      },
    };

    return await this.sendRequest(phoneNumber, interactiveBody, 'interactive');
  }

  async sendCtaUrlMessage(
    phoneNumber: string,
    message: string,
    ctaUrl: { displayText: string; url: string }
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    const truncatedMessage = truncateBody(
      message,
      WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH,
      'CTA URL',
      phoneNumber
    );

    const ctaUrlBody = {
      type: 'interactive' as const,
      interactive: {
        type: 'cta_url' as const,
        body: { text: truncatedMessage },
        action: { name: 'cta_url' as const, parameters: { display_text: ctaUrl.displayText, url: ctaUrl.url } },
      },
    };

    return await this.sendRequest(phoneNumber, ctaUrlBody, 'CTA URL');
  }

  async sendMessageDigestTemplate(
    phoneNumber: string,
    template: WhatsAppMessageDigestTemplate
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    const isV2 = template.kind === 'message_digest_v2';
    const bodyParameters = isV2
      ? [
          template.windowLabel,
          template.headline,
          ...compactMessageDigestSections(template.digestBody, [
            template.digestName,
            template.windowLabel,
            template.headline,
          ]),
        ]
      : [template.digestExcerpt];
    return await this.sendRequest(
      phoneNumber,
      {
        type: 'template',
        template: {
          name: isV2 ? MESSAGE_DIGEST_TEMPLATE_V2_NAME : MESSAGE_DIGEST_TEMPLATE_V1_NAME,
          language: {
            code: isV2
              ? MESSAGE_DIGEST_TEMPLATE_V2_LANGUAGE
              : MESSAGE_DIGEST_TEMPLATE_V1_LANGUAGE,
          },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: template.digestName },
                ...bodyParameters.map((text) => ({ type: 'text' as const, text })),
              ],
            },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: template.runUrlSuffix }],
            },
          ],
        },
      },
      'Message Digest template'
    );
  }

  private async sendRequest(
    phoneNumber: string,
    body: WhatsAppMessageBody,
    messageTypeLabel: MessageTypeLabel
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    const recipientHint = getRecipientLogHint(phoneNumber);
    logger.info(
      { recipientHint, messageType: messageTypeLabel },
      `Sending WhatsApp ${messageTypeLabel} message`
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, WHATSAPP_MESSAGE_SEND_TIMEOUT_MS);

    try {
      // Remove + prefix if present for WhatsApp API
      const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber;

      const response = await performHttpFetch(`${WHATSAPP_API_BASE}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedPhone,
          ...body,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const providerErrorMetadata = extractProviderErrorMetadata(errorBody);
        logger.error(
          {
            status: response.status,
            responseBytes: Buffer.byteLength(errorBody, 'utf8'),
            ...providerErrorMetadata,
            errorClass: 'provider_response',
            [SKIP_SENTRY_KEY]: true,
          },
          `WhatsApp API returned error for ${messageTypeLabel}`
        );
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `WhatsApp API request failed with status ${String(response.status)}`,
          httpStatus: response.status,
        });
      }

      // Parse response to get wamid
      const responseBody = (await response.json()) as {
        messages?: { id?: string }[];
      };
      const wamid = responseBody.messages?.[0]?.id ?? `unknown-${String(Date.now())}`;

      logger.info({ recipientHint }, `${messageTypeLabel} message sent successfully`);
      return ok({ wamid });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.error(
          {
            recipientHint,
            timeoutMs: WHATSAPP_MESSAGE_SEND_TIMEOUT_MS,
            [SKIP_SENTRY_KEY]: true,
          },
          'WhatsApp request timed out'
        );
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `WhatsApp request timed out after ${String(WHATSAPP_MESSAGE_SEND_TIMEOUT_MS)}ms`,
        });
      }

      logger.error(
        {
          recipientHint,
          errorClass: classifyTransportError(error),
          [SKIP_SENTRY_KEY]: true,
        },
        `Failed to send WhatsApp ${messageTypeLabel} message`
      );
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to send WhatsApp ${messageTypeLabel} message`,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function extractProviderErrorMetadata(responseText: string): ProviderErrorMetadata {
  try {
    const payload: unknown = JSON.parse(responseText);
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
    const error = (payload as Record<string, unknown>)['error'];
    if (typeof error !== 'object' || error === null || Array.isArray(error)) return {};
    const record = error as Record<string, unknown>;
    const code = record['code'];
    const subcode = record['error_subcode'];
    return {
      ...(isSafeProviderCode(code) ? { providerCode: code } : {}),
      ...(isSafeProviderCode(subcode) ? { providerSubcode: subcode } : {}),
    };
  } catch {
    return {};
  }
}

function isSafeProviderCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function classifyTransportError(error: unknown): 'type_error' | 'error' | 'non_error' {
  if (error instanceof TypeError) return 'type_error';
  return error instanceof Error ? 'error' : 'non_error';
}

function getRecipientLogHint(phoneNumber: string): string {
  const normalized = phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber;
  const suffix = normalized.slice(-2);
  return suffix === '' ? '[redacted]' : `***${suffix}`;
}
