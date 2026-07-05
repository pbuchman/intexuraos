import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPdfConversationExporter } from '../conversationPdfExporter.js';
import type { PdfConversationExportInput } from '../types.js';

const validInput: PdfConversationExportInput = {
  title: 'Alice context',
  modelName: 'MiniMax M3',
  initialPrompt: 'What happened?',
  generatedAt: '2026-07-03T16:00:00.000Z',
  sourceRange: {
    from: '2026-06-30T00:00:00.000Z',
    to: '2026-07-01T00:00:00.000Z',
  },
  effectiveRange: {
    from: '2026-06-30T10:00:00.000Z',
    to: '2026-06-30T10:45:00.000Z',
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
    { role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: 'User line '.repeat(120) },
    {
      role: 'assistant',
      createdAt: '2026-07-03T16:02:00.000Z',
      text: 'Assistant answer with\nmultiple lines.',
    },
  ],
};

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('pdfkit');
});

describe('createPdfConversationExporter', () => {
  it('renders an A4 PDF conversation snapshot without truncating messages', async () => {
    const exporter = createPdfConversationExporter();

    const result = await exporter.exportConversation(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.contentType).toBe('application/pdf');
    expect(result.value.fileName).toBe('alice-context.pdf');
    expect(result.value.bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(extractMediaBoxes(result.value.bytes)).toContain('0 0 595.28 841.89');

    const pdfText = extractPdfText(result.value.bytes);
    const readablePdfText = toReadablePdfText(pdfText);
    const normalizedPdfText = normalizePdfText(readablePdfText);
    expect(readablePdfText).toContain('Alice context');
    expect(readablePdfText).toContain('Generated at 2026-07-03T16:00:00.000Z');
    expect(readablePdfText).toContain(
      'Information range: 2026-06-30T00:00:00.000Z to 2026-07-01T00:00:00.000Z'
    );
    expect(readablePdfText).toContain(
      'Effective range: 2026-06-30T10:00:00.000Z to 2026-06-30T10:45:00.000Z'
    );
    expect(readablePdfText).toContain('Messages taken under consideration: 47');
    expect(readablePdfText).toContain('Messages excluded: 23');
    expect(readablePdfText).toContain('Media Only');
    expect(readablePdfText).toContain('Failed Transcriptions');
    expect(normalizedPdfText).toContain(normalizePdfText('Assistant answer with\nmultiple lines.'));
    expect(normalizedPdfText).toContain(normalizePdfText(validInput.messages[0]?.text ?? ''));
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
      { ...validInput, modelName: '   ' },
      { ...validInput, initialPrompt: '   ' },
      { ...validInput, generatedAt: '   ' },
      { ...validInput, sourceRange: { from: '', to: validInput.sourceRange.to } },
      { ...validInput, sourceRange: { from: validInput.sourceRange.from, to: '' } },
      { ...validInput, effectiveRange: { from: '', to: validInput.effectiveRange.to } },
      { ...validInput, effectiveRange: { from: validInput.effectiveRange.from, to: '' } },
      { ...validInput, messageCounts: { included: -1, excluded: 0 } },
      { ...validInput, messageCounts: { included: 0, excluded: -1 } },
      { ...validInput, messages: [{ ...firstMessage, text: '' }] },
    ];

    for (const input of invalidInputs) {
      const result = await exporter.exportConversation(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_INPUT');
      }
    }
  });

  it('renders non-Latin titles with a safe fallback filename', async () => {
    const exporter = createPdfConversationExporter();

    const result = await exporter.exportConversation({
      ...validInput,
      title: 'Что решили?',
      messages: [{ role: 'user', createdAt: '2026-07-03T16:01:00.000Z', text: 'hello' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.fileName).toBe('conversation-export.pdf');
    expect(result.value.bytes.toString('latin1')).toContain('NotoSans');
  });

  it('uses the fallback title when markdown cleanup removes the provided title', async () => {
    const exporter = createPdfConversationExporter();

    const result = await exporter.exportConversation({
      ...validInput,
      title: '```',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.fileName).toBe('conversation-export.pdf');
    expect(toReadablePdfText(extractPdfText(result.value.bytes))).toContain('conversation-export');
  });

  it('renders model attribution, initial prompt, and markdown answers as plain text', async () => {
    const exporter = createPdfConversationExporter();
    const input = {
      ...validInput,
      title: '# Decision **summary**',
      modelName: 'Claude Sonnet 5',
      initialPrompt: '- Please decide what to include.',
      messages: [
        {
          role: 'user' as const,
          createdAt: '2026-07-03T16:01:00.000Z',
          text: 'Please decide what to include.',
        },
        {
          role: 'assistant' as const,
          createdAt: '2026-07-03T16:02:00.000Z',
          text: [
            '# Decision',
            '',
            '**Include** the timeline and [evidence](https://example.test/evidence).',
            '',
            '- First action',
            '- [ ] Follow up',
            '| Owner | Task |',
            '| --- | --- |',
            '| Alice | Prepare docs |',
            '![chart](https://example.test/chart.png)',
            '',
            '```text',
            'Keep this raw line',
            '```',
          ].join('\n'),
        },
      ],
    } as PdfConversationExportInput;

    const result = await exporter.exportConversation(input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const readablePdfText = toReadablePdfText(extractPdfText(result.value.bytes));
    const normalizedPdfText = normalizePdfText(readablePdfText);
    expect(readablePdfText).toContain('Decision summary');
    expect(readablePdfText).toContain('LLM model: Claude Sonnet 5');
    expect(readablePdfText).toContain('Initial prompt: Please decide what to include.');
    expect(readablePdfText).toContain('LLM response (Claude Sonnet 5)');
    expect(readablePdfText).toContain('Decision');
    expect(readablePdfText).toContain(
      'Include the timeline and evidence (https://example.test/evidence).'
    );
    expect(readablePdfText).toContain('First action');
    expect(readablePdfText).toContain('Follow up');
    expect(normalizedPdfText).toContain(normalizePdfText('Owner Task\nAlice Prepare docs'));
    expect(readablePdfText).toContain('chart (https://example.test/chart.png)');
    expect(readablePdfText).toContain('Keep this raw line');
    expect(readablePdfText).not.toContain('# Decision **summary**');
    expect(readablePdfText).not.toContain('# Decision');
    expect(readablePdfText).not.toContain('**Include**');
    expect(readablePdfText).not.toContain('- First action');
    expect(readablePdfText).not.toContain('- [ ] Follow up');
    expect(readablePdfText).not.toContain('| --- | --- |');
    expect(readablePdfText).not.toContain('![chart]');
    expect(readablePdfText).not.toContain('[evidence]');
    expect(readablePdfText).not.toContain('```');
  });

  it('renders page breaks without an omitted breakdown', async () => {
    const exporter = createPdfConversationExporter();
    const finalMessageText = 'Final page message survives pagination.';

    const result = await exporter.exportConversation({
      title: validInput.title,
      modelName: validInput.modelName,
      initialPrompt: validInput.initialPrompt,
      generatedAt: validInput.generatedAt,
      sourceRange: validInput.sourceRange,
      effectiveRange: validInput.effectiveRange,
      messageCounts: { included: 81, excluded: 0 },
      messages: [
        ...Array.from({ length: 80 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          createdAt: `2026-07-03T16:${String(index).padStart(2, '0')}:00.000Z`,
          text: `Message ${String(index)} `.repeat(40),
        })),
        {
          role: 'assistant' as const,
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
      ...validInput,
      title: 'Łódź context',
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

    const result = await exporter.exportConversation(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RENDER_FAILED');
      expect(result.error.message).toBe('render broke');
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

    const result = await exporter.exportConversation(validInput);

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

function extractMediaBoxes(bytes: Buffer): string[] {
  const source = bytes.toString('latin1');
  return [...source.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((match) =>
    String(match[1]).replace(/\s+/g, ' ').trim()
  );
}
