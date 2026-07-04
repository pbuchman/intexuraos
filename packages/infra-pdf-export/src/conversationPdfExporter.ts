import PDFDocument from 'pdfkit';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type {
  PdfConversationExporter,
  PdfConversationExportInput,
  PdfExportError,
} from './types.js';

const FALLBACK_FILE_NAME = 'conversation-assistant-export';

export function createPdfConversationExporter(): PdfConversationExporter {
  return {
    async exportConversation(
      input: PdfConversationExportInput
    ): ReturnType<PdfConversationExporter['exportConversation']> {
      const validation = validateInput(input);
      if (validation !== null) {
        return err(validation);
      }

      try {
        const bytes = await renderConversationPdf(input);
        return ok({
          bytes,
          fileName: `${sanitizeBaseFileName(input.title)}.pdf`,
          contentType: 'application/pdf',
        });
      } catch (error) {
        return err({
          code: 'RENDER_FAILED',
          message: getErrorMessage(error, 'PDF rendering failed'),
        });
      }
    },
  };
}

function validateInput(input: PdfConversationExportInput): PdfExportError | null {
  if (input.title.trim().length === 0) {
    return { code: 'INVALID_INPUT', message: 'title is required' };
  }
  if (input.generatedAt.trim().length === 0) {
    return { code: 'INVALID_INPUT', message: 'generatedAt is required' };
  }
  if (input.sourceRange.from.trim().length === 0 || input.sourceRange.to.trim().length === 0) {
    return { code: 'INVALID_INPUT', message: 'sourceRange is required' };
  }
  if (input.messageCounts.included < 0 || input.messageCounts.excluded < 0) {
    return { code: 'INVALID_INPUT', message: 'messageCounts cannot be negative' };
  }
  return null;
}

async function renderConversationPdf(input: PdfConversationExportInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
  });

  doc.font('Helvetica-Bold').fontSize(20).text(input.title, { width: 499 });
  doc.moveDown(0.6);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#555555')
    .text(`Generated: ${input.generatedAt}`)
    .text(`Source range: ${input.sourceRange.from} to ${input.sourceRange.to}`)
    .text(`Messages considered: ${String(input.messageCounts.included)}`)
    .text(`Messages excluded: ${String(input.messageCounts.excluded)}`);

  if (input.omittedBreakdown !== undefined) {
    doc.text(
      `Excluded breakdown: media-only ${String(input.omittedBreakdown.mediaOnly)}, failed transcriptions ${String(input.omittedBreakdown.failedTranscriptions)}, pending transcriptions ${String(input.omittedBreakdown.pendingTranscriptions)}, non-text ${String(input.omittedBreakdown.nonText)}, over limit ${String(input.omittedBreakdown.overLimit)}`
    );
  }

  doc.moveDown(1.2);
  for (const message of input.messages) {
    ensureSpace(doc, 72);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(message.role === 'assistant' ? '#0f766e' : '#1f2937')
      .text(`${message.role === 'assistant' ? 'Assistant' : 'User'} - ${message.createdAt}`);
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#111827')
      .text(message.text, { width: 499, lineGap: 3 });
    doc.moveDown(0.8);
  }

  doc.end();
  return await finished;
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number): void {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function sanitizeBaseFileName(title: string): string {
  const sanitized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return sanitized.length > 0 ? sanitized : FALLBACK_FILE_NAME;
}
