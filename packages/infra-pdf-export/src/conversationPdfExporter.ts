import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { err, ok } from '@intexuraos/common-core';
import type { Result } from '@intexuraos/common-core';
import type {
  PdfConversationExportInput,
  PdfConversationExporter,
  PdfConversationExportResult,
  PdfExportError,
} from './types.js';

const PAGE_MARGIN = 36;
const SECTION_GAP = 18;
const BLOCK_GAP = 10;
const STANDARD_REGULAR_FONT = 'Helvetica';
const STANDARD_BOLD_FONT = 'Helvetica-Bold';
const UNICODE_REGULAR_FONT = 'NotoSansRegular';
const UNICODE_BOLD_FONT = 'NotoSansBold';
const require = createRequire(import.meta.url);
const REGULAR_FONT_PATH =
  require.resolve('@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf');
const BOLD_FONT_PATH = require.resolve('@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf');

export function createPdfConversationExporter(): PdfConversationExporter {
  return {
    async exportConversation(input): Promise<Result<PdfConversationExportResult, PdfExportError>> {
      const validationError = validateInput(input);
      if (validationError !== null) {
        return err(validationError);
      }

      try {
        const bytes = await renderPdf(input);
        return ok<PdfConversationExportResult>({
          bytes,
          fileName: `${createBaseFileName(input.title)}.pdf`,
          contentType: 'application/pdf',
        });
      } catch (error) {
        return err({
          code: 'RENDER_FAILED',
          message: getErrorMessage(error, 'Failed to render PDF conversation export'),
        });
      }
    },
  };
}

function validateInput(input: PdfConversationExportInput): PdfExportError | null {
  if (input.title.trim().length === 0) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export title cannot be empty',
    };
  }

  const hasEmptyMessage = input.messages.some((message) => message.text.trim().length === 0);
  if (hasEmptyMessage) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export messages cannot contain empty text',
    };
  }

  return null;
}

async function renderPdf(input: PdfConversationExportInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    compress: false,
  });
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer | Uint8Array | string) => {
      chunks.push(toBuffer(chunk));
    });
    doc.on('error', reject);
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    registerConversationFonts(doc);
    drawConversation(doc, input);
    doc.end();
  });
}

function registerConversationFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont(UNICODE_REGULAR_FONT, REGULAR_FONT_PATH);
  doc.registerFont(UNICODE_BOLD_FONT, BOLD_FONT_PATH);
}

function drawConversation(doc: PDFKit.PDFDocument, input: PdfConversationExportInput): void {
  const contentWidth = getContentWidth(doc);

  doc.info.Title = input.title;
  doc.font(fontForText(input.title, 'bold')).fontSize(20).fillColor('#111827');
  doc.text(input.title, {
    width: contentWidth,
    align: 'left',
  });

  doc.moveDown(0.35);
  const generatedAtText = `Generated at ${input.generatedAt}`;
  doc.font(fontForText(generatedAtText, 'regular')).fontSize(9).fillColor('#6b7280');
  doc.text(generatedAtText, {
    width: contentWidth,
    align: 'left',
  });

  doc.moveDown(0.9);
  drawDivider(doc, contentWidth);
  doc.moveDown(0.9);

  drawMetadataLine(
    doc,
    contentWidth,
    'Source range',
    `${input.sourceRange.from} to ${input.sourceRange.to}`
  );
  drawMetadataLine(
    doc,
    contentWidth,
    'Messages taken under consideration',
    String(input.messageCounts.included)
  );
  drawMetadataLine(doc, contentWidth, 'Messages excluded', String(input.messageCounts.excluded));

  if (input.omittedBreakdown !== undefined) {
    drawMetadataLine(doc, contentWidth, 'Omitted breakdown', '');
    for (const [key, value] of Object.entries(input.omittedBreakdown)) {
      drawIndentedMetadataLine(doc, contentWidth, formatBreakdownLabel(key), String(value));
    }
  }

  doc.moveDown(0.9);
  drawDivider(doc, contentWidth);
  doc.moveDown(0.9);

  for (const message of input.messages) {
    drawMessage(doc, contentWidth, message.role, message.createdAt, message.text);
  }
}

function drawMetadataLine(
  doc: PDFKit.PDFDocument,
  contentWidth: number,
  label: string,
  value: string
): void {
  const lineText = value.length > 0 ? `${label}: ${value}` : `${label}:`;
  doc.font(fontForText(lineText, 'regular')).fontSize(10);
  ensureSpace(doc, doc.heightOfString(lineText, { width: contentWidth }) + BLOCK_GAP);
  doc.fillColor('#1f2937');
  doc.text(lineText, { width: contentWidth, lineGap: 1.5 });
  doc.moveDown(0.2);
}

function drawIndentedMetadataLine(
  doc: PDFKit.PDFDocument,
  contentWidth: number,
  label: string,
  value: string
): void {
  const indent = 14;
  const lineText = `${label}: ${value}`;
  doc.font(fontForText(lineText, 'regular')).fontSize(10);
  ensureSpace(doc, doc.heightOfString(lineText, { width: contentWidth - indent }) + BLOCK_GAP);
  doc.fillColor('#4b5563');
  doc.text(lineText, doc.x + indent, doc.y, {
    width: contentWidth - indent,
    lineGap: 1.5,
  });
  doc.moveDown(0.2);
}

function drawMessage(
  doc: PDFKit.PDFDocument,
  contentWidth: number,
  role: 'user' | 'assistant',
  createdAt: string,
  text: string
): void {
  const roleLabel = role === 'user' ? 'User' : 'Assistant';
  const headerText = `${roleLabel}  ${createdAt}`;
  const headerFont = fontForText(headerText, 'bold');
  const textFont = fontForText(text, 'regular');
  doc.font(headerFont).fontSize(11);
  const headerHeight = doc.heightOfString(headerText, { width: contentWidth });
  doc.font(textFont).fontSize(10.5);
  const textHeight = doc.heightOfString(text, { width: contentWidth });
  const minimumHeight = headerHeight + textHeight + SECTION_GAP;
  ensureSpace(doc, minimumHeight);

  doc
    .font(headerFont)
    .fontSize(11)
    .fillColor(role === 'user' ? '#0f172a' : '#1d4ed8');
  doc.text(headerText, {
    width: contentWidth,
    lineGap: 1.5,
  });

  doc.moveDown(0.2);
  doc.font(textFont).fontSize(10.5).fillColor('#111827');
  doc.text(text, {
    width: contentWidth,
    lineGap: 2,
  });

  doc.moveDown(0.8);
}

function drawDivider(doc: PDFKit.PDFDocument, contentWidth: number): void {
  ensureSpace(doc, 4);
  const startX = doc.page.margins.left;
  const endX = startX + contentWidth;
  const lineY = doc.y;

  doc
    .save()
    .lineWidth(1)
    .strokeColor('#d1d5db')
    .moveTo(startX, lineY)
    .lineTo(endX, lineY)
    .stroke()
    .restore();
}

function ensureSpace(doc: PDFKit.PDFDocument, requiredHeight: number): void {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + requiredHeight <= bottomLimit) {
    return;
  }

  doc.addPage({
    size: 'A4',
    margin: PAGE_MARGIN,
  });
}

function getContentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function fontForText(text: string, weight: 'regular' | 'bold'): string {
  if (/[\u0080-\uFFFF]/.test(text)) {
    return weight === 'bold' ? UNICODE_BOLD_FONT : UNICODE_REGULAR_FONT;
  }

  return weight === 'bold' ? STANDARD_BOLD_FONT : STANDARD_REGULAR_FONT;
}

function createBaseFileName(title: string): string {
  const sanitizedTitle = sanitizeTitle(title);
  return sanitizedTitle.length > 0 ? sanitizedTitle : 'conversation-export';
}

function sanitizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatBreakdownLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (first) => first.toUpperCase());
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}

function toBuffer(chunk: Buffer | Uint8Array | string): Buffer {
  return Buffer.from(chunk);
}
