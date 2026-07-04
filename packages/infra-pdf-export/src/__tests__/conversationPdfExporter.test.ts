import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPdfConversationExporter } from '../conversationPdfExporter.js';
import type { PdfConversationExportInput } from '../types.js';

const validInput: PdfConversationExportInput = {
  title: 'Alice context',
  generatedAt: '2026-07-03T16:00:00.000Z',
  sourceRange: {
    from: '2026-06-30T00:00:00.000Z',
    to: '2026-07-01T00:00:00.000Z',
  },
  messageCounts: { included: 9, excluded: 6 },
  omittedBreakdown: {
    mediaOnly: 2,
    failedTranscriptions: 1,
    pendingTranscriptions: 0,
    nonText: 3,
    overLimit: 0,
  },
  messages: [
    { role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: 'User line '.repeat(120) },
    {
      role: 'assistant',
      createdAt: '2026-07-03T16:02:00.000Z',
      text: 'Assistant answer with\nmultiple lines.',
    },
  ],
};

function extractPdfText(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  return Array.from(raw.matchAll(/<([0-9a-fA-F]+)>/g), ([, hex]) =>
    Buffer.from(hex ?? '', 'hex').toString('latin1')
  ).join('');
}

describe('createPdfConversationExporter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an A4 PDF conversation snapshot without truncating messages', async () => {
    const exporter = createPdfConversationExporter();

    const result = await exporter.exportConversation(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentType).toBe('application/pdf');
    expect(result.value.fileName).toBe('alice-context.pdf');
    expect(result.value.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const pdfText = extractPdfText(result.value.bytes);
    expect(pdfText).toContain('Alice context');
    expect(pdfText).toContain('Messages taken under consideration: 9');
    expect(pdfText).toContain('Messages excluded: 6');
    expect(pdfText).toContain('Assistant answer with');
    expect(pdfText).toContain('multiple lines.');
    expect(pdfText).toContain('User line User line');
  });

  it('renders paginated PDFs and falls back when the sanitized filename is empty', async () => {
    const exporter = createPdfConversationExporter();

    const result = await exporter.exportConversation({
      ...validInput,
      title: '!!!',
      messages: Array.from({ length: 80 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        createdAt: `2026-07-03T16:${String(index).padStart(2, '0')}:00.000Z`,
        text: `Message ${String(index)} ${'body '.repeat(40)}`,
      })),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fileName).toBe('conversation-assistant-export.pdf');
    expect(result.value.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders PDFs without an omitted breakdown', async () => {
    const exporter = createPdfConversationExporter();
    const { omittedBreakdown: _omittedBreakdown, ...input } = validInput;

    const result = await exporter.exportConversation(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('rejects invalid input before rendering', async () => {
    const exporter = createPdfConversationExporter();
    const firstMessage = validInput.messages[0] ?? {
      role: 'user' as const,
      createdAt: '2026-07-03T16:01:00.000Z',
      text: 'fallback',
    };

    const invalidInputs: PdfConversationExportInput[] = [
      { ...validInput, title: '   ' },
      { ...validInput, generatedAt: '   ' },
      { ...validInput, sourceRange: { from: '', to: validInput.sourceRange.to } },
      { ...validInput, sourceRange: { from: validInput.sourceRange.from, to: '' } },
      { ...validInput, messageCounts: { included: -1, excluded: 0 } },
      { ...validInput, messageCounts: { included: 0, excluded: -1 } },
      { ...validInput, messages: [{ ...firstMessage, text: '' }] },
    ];

    for (const input of invalidInputs) {
      const result = await exporter.exportConversation(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('maps PDFKit render failures to exporter errors', async () => {
    const exporter = createPdfConversationExporter();
    vi.spyOn(PDFDocument.prototype, 'end').mockImplementation(function endWithError(
      this: PDFKit.PDFDocument
    ): PDFKit.PDFDocument {
      this.emit('error', new Error('render exploded'));
      return this;
    });

    const result = await exporter.exportConversation(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'RENDER_FAILED', message: 'render exploded' });
    }
  });
});
