import { createHash } from 'node:crypto';
import type {
  MessageDigestWhatsAppPreview,
  MessageDigestWhatsAppPreviewIcon,
} from '@intexuraos/llm-prompts';
import {
  MESSAGE_DIGEST_WHATSAPP_PREVIEW_ITEM_MAX_LENGTH,
  MESSAGE_DIGEST_WHATSAPP_PREVIEW_MAX_ITEMS_PER_SECTION,
  MESSAGE_DIGEST_WHATSAPP_PREVIEW_MAX_SECTIONS,
  MESSAGE_DIGEST_WHATSAPP_PREVIEW_SECTION_TITLE_MAX_LENGTH,
} from '@intexuraos/llm-prompts';
import {
  buildSendMessageEvent,
  MESSAGE_DIGEST_EVENT_MESSAGE,
  MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS,
  type SendMessageEvent,
} from '@intexuraos/whatsapp-pubsub-client';
import type { MessageDigestRun } from '../../domain/models/messageDigestRun.js';

const ICON_BY_KIND: Readonly<Record<MessageDigestWhatsAppPreviewIcon, string>> = {
  attention: '🔴',
  people: '👥',
  location: '📍',
  decision: '✅',
  question: '❓',
  sentiment: '💬',
  update: '📌',
};
const OMITTED_CONTENT_COPY = 'Więcej w pełnym podsumowaniu…';

interface NormalizedPreviewSection {
  icon: MessageDigestWhatsAppPreviewIcon;
  title: string;
  items: string[];
}

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
  preview: MessageDigestWhatsAppPreview;
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
  if (normalizeWebAppUrl(input.webAppUrl) === null) {
    return { ok: false, code: 'INVALID_WEB_APP_URL' };
  }

  const headline = normalizeSingleLine(input.run.headline);
  const digestName = normalizeSingleLine(input.run.definitionNameSnapshot);
  const summary = sanitizeText(input.run.summaryMarkdown).trim();
  const preview = normalizePreview(input.preview);
  const windowLabel = formatWindowLabel(input.run);
  if (
    digestName === '' ||
    headline === '' ||
    summary === '' ||
    preview === null ||
    windowLabel === null ||
    codePointLength(digestName) > MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS ||
    codePointLength(headline) > MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS ||
    codePointLength(windowLabel) > MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS ||
    containsUnsafeLinkConstruct(digestName) ||
    containsUnsafeLinkConstruct(headline) ||
    containsOpaqueMessageReference([
      digestName,
      headline,
      ...preview.flatMap((section) => [section.title, ...section.items]),
    ])
  ) {
    return { ok: false, code: 'INVALID_RUN_OUTPUT' };
  }

  const digestBody = renderPreview(preview);
  if (digestBody === null) return { ok: false, code: 'INVALID_RUN_OUTPUT' };
  const runUrlSuffix = `#/whatsapp/message-digests/${encodeURIComponent(
    input.run.definitionId
  )}/history/${encodeURIComponent(input.run.runId)}`;
  const built = buildSendMessageEvent({
    userId: input.run.userId,
    message: MESSAGE_DIGEST_EVENT_MESSAGE,
    correlationId: input.run.runId,
    timestamp: input.run.completedAt,
    presentation: {
      kind: 'message_digest_v2',
      digestName,
      windowLabel,
      headline,
      digestBody,
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

function normalizePreview(value: MessageDigestWhatsAppPreview): NormalizedPreviewSection[] | null {
  const candidate = value as unknown;
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const preview = candidate as Record<string, unknown>;
  if (
    Object.keys(preview).length !== 1 ||
    !Array.isArray(preview['sections']) ||
    preview['sections'].length < 1 ||
    preview['sections'].length > MESSAGE_DIGEST_WHATSAPP_PREVIEW_MAX_SECTIONS
  ) {
    return null;
  }
  const normalized: NormalizedPreviewSection[] = [];
  for (const sectionValue of preview['sections']) {
    if (sectionValue === null || typeof sectionValue !== 'object' || Array.isArray(sectionValue)) {
      return null;
    }
    const section = sectionValue as Record<string, unknown>;
    if (
      Object.keys(section).length !== 3 ||
      typeof section['icon'] !== 'string' ||
      !Object.hasOwn(ICON_BY_KIND, section['icon']) ||
      typeof section['title'] !== 'string' ||
      !Array.isArray(section['items']) ||
      section['items'].length < 1 ||
      section['items'].length > MESSAGE_DIGEST_WHATSAPP_PREVIEW_MAX_ITEMS_PER_SECTION
    ) {
      return null;
    }
    const title = normalizeSingleLine(section['title']);
    const items = section['items'].map((item) =>
      typeof item === 'string' ? normalizeSingleLine(item) : null
    );
    if (
      title === '' ||
      codePointLength(title) > MESSAGE_DIGEST_WHATSAPP_PREVIEW_SECTION_TITLE_MAX_LENGTH ||
      containsUnsafeLinkConstruct(title) ||
      items.some(
        (item) =>
          item === null ||
          item === '' ||
          codePointLength(item) > MESSAGE_DIGEST_WHATSAPP_PREVIEW_ITEM_MAX_LENGTH ||
          containsUnsafeLinkConstruct(item)
      )
    ) {
      return null;
    }
    normalized.push({
      icon: section['icon'] as MessageDigestWhatsAppPreviewIcon,
      title,
      items: items as string[],
    });
  }
  return normalized;
}

function renderPreview(sections: NormalizedPreviewSection[]): string | null {
  const rendered = sections.map(
    (section) =>
      `${ICON_BY_KIND[section.icon]} ${section.title.toLocaleUpperCase('pl-PL')}\n${section.items.join('\n')}`
  );
  const selected: string[] = [];
  let omitted = false;
  for (const [index, section] of rendered.entries()) {
    const candidate = [...selected, section].join('\n\n');
    const hasRemaining = index < rendered.length - 1;
    const candidateWithOmission = `${candidate}\n\n${OMITTED_CONTENT_COPY}`;
    if (
      codePointLength(candidate) > MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS ||
      (hasRemaining &&
        codePointLength(candidateWithOmission) > MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS)
    ) {
      omitted = true;
      break;
    }
    selected.push(section);
  }
  if (selected.length === 0) return null;
  return `${selected.join('\n\n')}${omitted ? `\n\n${OMITTED_CONTENT_COPY}` : ''}`;
}

function formatWindowLabel(run: MessageDigestRun): string | null {
  const start = new Date(run.windowStart);
  const end = new Date(run.windowEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  try {
    const formatter = new Intl.DateTimeFormat('pl-PL', {
      timeZone: run.scheduleSnapshot.timeZone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    return `${formatter.format(start)} – ${formatter.format(end)}`.replaceAll('.', '');
  } catch {
    return null;
  }
}

function containsOpaqueMessageReference(values: string[]): boolean {
  const pattern = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/iu;
  return values.some((value) => pattern.test(value));
}

function containsUnsafeLinkConstruct(value: string): boolean {
  if (/(?:https?:\/\/|www\.)[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)) {
    return true;
  }
  if (/!\[[^\]]*\]|\[[^\]]+\]\s*(?:\(|\[)|^\s*\[[^\]]+\]:/mu.test(value)) return true;
  return false;
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

function normalizeSingleLine(value: string): string {
  return sanitizeText(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function codePointLength(value: string): number {
  return Array.from(value).length;
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
