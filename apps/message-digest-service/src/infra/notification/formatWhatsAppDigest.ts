import { createHash } from 'node:crypto';
import {
  buildSendMessageEvent,
  MESSAGE_DIGEST_EVENT_MESSAGE,
  MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS,
  type SendMessageEvent,
} from '@intexuraos/whatsapp-pubsub-client';
import type { MessageDigestRun } from '../../domain/models/messageDigestRun.js';

export type FormatWhatsAppDigestResult =
  | {
      ok: true;
      value: {
        event: SendMessageEvent;
        payloadJson: string;
        payloadDigest: string;
      };
    }
  | {
      ok: false;
      code: 'RUN_NOT_COMPLETED' | 'INVALID_RUN_OUTPUT' | 'INVALID_WEB_APP_URL' | 'INVALID_EVENT';
    };

export function formatWhatsAppDigest(input: {
  run: MessageDigestRun;
  webAppUrl: string;
}): FormatWhatsAppDigestResult {
  if (
    input.run.generationStatus !== 'completed' ||
    input.run.processingStage !== 'completed' ||
    input.run.completedAt === null
  ) {
    return { ok: false, code: 'RUN_NOT_COMPLETED' };
  }
  if (input.run.headline === null || input.run.summaryMarkdown === null) {
    return { ok: false, code: 'INVALID_RUN_OUTPUT' };
  }
  const headline = sanitizeText(input.run.headline).replace(/\s+/gu, ' ').trim();
  const digestName = sanitizeText(input.run.definitionNameSnapshot).replace(/\s+/gu, ' ').trim();
  const summary = sanitizeText(input.run.summaryMarkdown).trim();
  if (digestName === '' || headline === '' || summary === '') {
    return { ok: false, code: 'INVALID_RUN_OUTPUT' };
  }
  if (normalizeWebAppUrl(input.webAppUrl) === null) {
    return { ok: false, code: 'INVALID_WEB_APP_URL' };
  }

  const runUrlSuffix = `#/whatsapp/message-digests/${encodeURIComponent(
    input.run.definitionId
  )}/history/${encodeURIComponent(input.run.runId)}`;
  const digestExcerpt = truncateExcerpt(markdownToPlainText(summary));
  if (digestExcerpt === '') return { ok: false, code: 'INVALID_RUN_OUTPUT' };
  const built = buildSendMessageEvent({
    userId: input.run.userId,
    message: MESSAGE_DIGEST_EVENT_MESSAGE,
    correlationId: input.run.runId,
    timestamp: input.run.completedAt,
    presentation: {
      kind: 'message_digest_v1',
      digestName,
      digestExcerpt,
      runUrlSuffix,
    },
    deliveryAuthorization: {
      kind: 'message_digest_delivery_v1',
      definitionId: input.run.definitionId,
      runId: input.run.runId,
    },
    retainMessageText: false,
    important: true,
    idempotencyKey: input.run.delivery.idempotencyKey,
  });
  if (!built.ok) return { ok: false, code: 'INVALID_EVENT' };
  const payloadJson = JSON.stringify(built.value.event);
  return {
    ok: true,
    value: {
      event: built.value.event,
      payloadJson,
      payloadDigest: createHash('sha256').update(payloadJson, 'utf8').digest('hex'),
    },
  };
}

function markdownToPlainText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gmu, '')
    .replace(/[*_~]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function truncateExcerpt(value: string): string {
  const codePoints = Array.from(value);
  if (codePoints.length <= MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS) return value;
  return `${codePoints
    .slice(0, MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS - 1)
    .join('')}…`;
}

function normalizeWebAppUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null;
    }
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
}

function sanitizeText(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) as number;
      return !isUnsafeControlCodePoint(codePoint);
    })
    .join('');
}

function isUnsafeControlCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0 && codePoint <= 8) ||
    codePoint === 11 ||
    codePoint === 12 ||
    (codePoint >= 14 && codePoint <= 31) ||
    (codePoint >= 127 && codePoint <= 159) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}
