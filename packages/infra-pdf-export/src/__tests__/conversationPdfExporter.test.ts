import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPdfConversationExporter } from '../conversationPdfExporter.js';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('pdfkit');
});

describe('createPdfConversationExporter', () => {
  it('renders an A4 PDF conversation snapshot without truncating messages', async () => {
    const exporter = createPdfConversationExporter();
    const longUserText = 'User line '.repeat(120);

    const result = await exporter.exportConversation({
      title: 'Alice context',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 47, excluded: 23 },
      omittedBreakdown: {
        mediaOnly: 2,
        failedTranscriptions: 1,
        pendingTranscriptions: 0,
        nonText: 3,
        overLimit: 0,
      },
      messages: [
        { role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: longUserText },
        {
          role: 'assistant',
          createdAt: '2026-07-03T16:02:00.000Z',
          text: 'Assistant answer with\nmultiple lines.',
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.contentType).toBe('application/pdf');
    expect(result.value.fileName).toBe('alice-context.pdf');
    expect(result.value.bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');

    const pdfText = extractPdfText(result.value.bytes);
    const readablePdfText = toReadablePdfText(pdfText);
    const normalizedPdfText = normalizePdfText(readablePdfText);
    expect(readablePdfText).toContain('Alice context');
    expect(readablePdfText).toContain('2026-06-30T00:00:00.000Z to 2026-07-01T00:00:00.000Z');
    expect(readablePdfText).toContain('Messages taken under consideration: 47');
    expect(readablePdfText).toContain('Messages excluded: 23');
    expect(readablePdfText).toContain('Media Only');
    expect(readablePdfText).toContain('Failed Transcriptions');
    expect(normalizedPdfText).toContain(normalizePdfText('Assistant answer with\nmultiple lines.'));
    expect(normalizedPdfText).toContain(normalizePdfText(longUserText));
  });

  it('rejects empty titles and empty message text', async () => {
    const exporter = createPdfConversationExporter();

    const emptyTitleResult = await exporter.exportConversation({
      title: ' ',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 0, excluded: 0 },
      messages: [{ role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: '' }],
    });

    expect(emptyTitleResult.ok).toBe(false);
    if (!emptyTitleResult.ok) {
      expect(emptyTitleResult.error.code).toBe('INVALID_INPUT');
      expect(emptyTitleResult.error.message).toContain('title cannot be empty');
    }

    const emptyMessageResult = await exporter.exportConversation({
      title: 'Alice context',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 1, excluded: 0 },
      messages: [{ role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: '' }],
    });

    expect(emptyMessageResult.ok).toBe(false);
    if (!emptyMessageResult.ok) {
      expect(emptyMessageResult.error.code).toBe('INVALID_INPUT');
      expect(emptyMessageResult.error.message).toContain('empty text');
    }

    const symbolTitleResult = await exporter.exportConversation({
      title: '!!!',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 1, excluded: 0 },
      messages: [{ role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: 'hello' }],
    });

    expect(symbolTitleResult.ok).toBe(true);
    if (symbolTitleResult.ok) {
      expect(symbolTitleResult.value.fileName).toBe('conversation-export.pdf');
    }
  });

  it('renders non-Latin titles with a safe fallback filename', async () => {
    const exporter = createPdfConversationExporter();

    const result = await exporter.exportConversation({
      title: 'Что решили?',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 1, excluded: 0 },
      messages: [{ role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: 'hello' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.fileName).toBe('conversation-export.pdf');
    expect(result.value.bytes.toString('latin1')).toContain('NotoSans');
  });

  it('renders page breaks without an omitted breakdown', async () => {
    const exporter = createPdfConversationExporter();
    const finalMessageText = 'Final page message survives pagination.';

    const result = await exporter.exportConversation({
      title: 'Paged context',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 81, excluded: 0 },
      messages: [
        ...Array.from({ length: 80 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          createdAt: `2026-07-03T16:${String(index).padStart(2, '0')}:00.000Z`,
          text: `Message ${index} `.repeat(40),
        })),
        {
          role: 'assistant',
          createdAt: '2026-07-03T17:30:00.000Z',
          text: finalMessageText,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const readablePdfText = toReadablePdfText(extractPdfText(result.value.bytes));
    expect(readablePdfText).not.toContain('Omitted breakdown');
    expect(readablePdfText).toContain(finalMessageText);
  });

  it('embeds a Unicode-capable font for multilingual conversation text', async () => {
    const exporter = createPdfConversationExporter();
    const multilingualText = 'Zażółć gęślą jaźń. Árvíztűrő tükörfúrógép. Кириллица.';

    const result = await exporter.exportConversation({
      title: 'Łódź context',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 1, excluded: 0 },
      messages: [{ role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: multilingualText }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const pdfSource = result.value.bytes.toString('latin1');
    expect(pdfSource).toContain('NotoSans');
  });

  it('returns RENDER_FAILED when PDF rendering throws', async () => {
    vi.resetModules();
    vi.doMock('pdfkit', () => ({
      default: function BrokenPdfDocument(): never {
        throw new Error('render broke');
      },
    }));

    const { createPdfConversationExporter: createBrokenExporter } =
      await import('../conversationPdfExporter.js');
    const exporter = createBrokenExporter();

    const result = await exporter.exportConversation({
      title: 'Alice context',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 1, excluded: 0 },
      messages: [
        {
          role: 'user',
          createdAt: '2026-07-03T16:01:00.000Z',
          text: 'hello',
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RENDER_FAILED');
    }
  });

  it('returns a fallback RENDER_FAILED message for non-error render failures', async () => {
    vi.resetModules();
    vi.doMock('pdfkit', () => ({
      default: function BrokenPdfDocument(): never {
        throw undefined;
      },
    }));

    const { createPdfConversationExporter: createBrokenExporter } =
      await import('../conversationPdfExporter.js');
    const exporter = createBrokenExporter();

    const result = await exporter.exportConversation({
      title: 'Alice context',
      generatedAt: '2026-07-03T16:00:00.000Z',
      sourceRange: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      messageCounts: { included: 1, excluded: 0 },
      messages: [
        {
          role: 'user',
          createdAt: '2026-07-03T16:01:00.000Z',
          text: 'hello',
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RENDER_FAILED');
      expect(result.error.message).toBe('Failed to render PDF conversation export');
    }
  });
});

function extractPdfText(bytes: Buffer): string {
  const source = bytes.toString('latin1');
  const parts: string[] = [];

  for (const match of source.matchAll(/<([0-9A-Fa-f]+)>|\(([^()]*)\)/g)) {
    const hex = match[1];
    const literal = match[2];

    if (hex !== undefined) {
      parts.push(Buffer.from(hex, 'hex').toString('latin1'));
      continue;
    }

    if (literal !== undefined) {
      parts.push(literal);
    }
  }

  return parts.join('');
}

function normalizePdfText(text: string): string {
  return text.replace(/\s+/g, '');
}

function toReadablePdfText(text: string): string {
  return text.replace(/\0/g, '');
}
