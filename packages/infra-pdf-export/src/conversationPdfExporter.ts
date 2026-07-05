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
const FALLBACK_FILE_NAME = 'conversation-export';
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

  if (input.modelName.trim().length === 0) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export modelName cannot be empty',
    };
  }

  if (input.initialPrompt.trim().length === 0) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export initialPrompt cannot be empty',
    };
  }

  if (input.generatedAt.trim().length === 0) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export generatedAt cannot be empty',
    };
  }

  if (input.sourceRange.from.trim().length === 0 || input.sourceRange.to.trim().length === 0) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export source range cannot be empty',
    };
  }

  if (
    input.effectiveRange.from.trim().length === 0 ||
    input.effectiveRange.to.trim().length === 0
  ) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export effective range cannot be empty',
    };
  }

  if (input.messageCounts.included < 0 || input.messageCounts.excluded < 0) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export message counts cannot be negative',
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
  const titleText = toPlainPdfText(input.title) || FALLBACK_FILE_NAME;

  doc.info.Title = titleText;
  doc.font(fontForText(titleText, 'bold')).fontSize(20).fillColor('#111827');
  doc.text(titleText, {
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

  doc.moveDown(0.35);
  drawMetadataLine(doc, contentWidth, 'LLM model', input.modelName);
  drawMetadataLine(doc, contentWidth, 'Initial prompt', toPlainPdfText(input.initialPrompt));

  doc.moveDown(0.9);
  drawDivider(doc, contentWidth);
  doc.moveDown(0.9);

  drawMetadataLine(
    doc,
    contentWidth,
    'Information range',
    `${input.sourceRange.from} to ${input.sourceRange.to}`
  );
  drawMetadataLine(
    doc,
    contentWidth,
    'Effective range',
    `${input.effectiveRange.from} to ${input.effectiveRange.to}`
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
    drawMessage(doc, contentWidth, message.role, message.createdAt, message.text, input.modelName);
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
  text: string,
  modelName: string
): void {
  const roleLabel = getMessageRoleLabel(role, modelName);
  const headerText = `${roleLabel}  ${createdAt}`;
  const plainText = toPlainPdfText(text);
  const headerFont = fontForText(headerText, 'bold');
  const textFont = fontForText(plainText, 'regular');
  doc.font(headerFont).fontSize(11);
  const headerHeight = doc.heightOfString(headerText, { width: contentWidth });
  doc.font(textFont).fontSize(10.5);
  const textHeight = doc.heightOfString(plainText, { width: contentWidth });
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
  doc.text(plainText, {
    width: contentWidth,
    lineGap: 2,
  });

  doc.moveDown(0.8);
}

function getMessageRoleLabel(role: 'user' | 'assistant', modelName: string): string {
  return role === 'assistant' ? `LLM response (${modelName})` : 'User';
}

function toPlainPdfText(text: string): string {
  const inlineCleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/^```[A-Za-z0-9_-]*\s*$/gm, '')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1');

  return inlineCleaned
    .split('\n')
    .map(cleanMarkdownLine)
    .filter((line) => line !== null)
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanMarkdownLine(line: string): string | null {
  const trimmed = line.trim();
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) {
    return null;
  }

  if (/^\|?.+\|.+\|?$/.test(trimmed)) {
    return trimmed
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0)
      .join(' ');
  }

  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^\s{0,3}[-*+]\s+\[[ xX]\]\s+/, '')
    .replace(/^\s{0,3}[-*+]\s+/, '')
    .replace(/^\s{0,3}\d+[.)]\s+/, '');
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
  const sanitizedTitle = sanitizeTitle(toPlainPdfText(title));
  return sanitizedTitle.length > 0 ? sanitizedTitle : FALLBACK_FILE_NAME;
}

function sanitizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
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
