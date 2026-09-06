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
const BLOCK_GAP = 10;
const TABLE_CELL_GAP = 8;
const TABLE_CELL_PADDING = 4;
const STANDARD_REGULAR_FONT = 'Helvetica';
const STANDARD_BOLD_FONT = 'Helvetica-Bold';
const UNICODE_REGULAR_FONT = 'NotoSansRegular';
const UNICODE_BOLD_FONT = 'NotoSansBold';
const FALLBACK_FILE_NAME = 'conversation-export';
const require = createRequire(import.meta.url);
const REGULAR_FONT_PATH =
  require.resolve('@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf');
const BOLD_FONT_PATH = require.resolve('@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf');

type PdfTextBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; rows: string[][] };

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

  if (input.assistantRoleLabel.trim().length === 0) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export assistantRoleLabel cannot be empty',
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

  if (
    input.cumulativeContext !== undefined &&
    (!Number.isInteger(input.cumulativeContext.snapshotCount) ||
      input.cumulativeContext.snapshotCount < 1 ||
      Object.values(input.cumulativeContext.counts).some(
        (count) => !Number.isInteger(count) || count < 0
      ))
  ) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export cumulative context summary is invalid',
    };
  }

  if (
    input.completedConversationRevision !== undefined &&
    (!Number.isInteger(input.completedConversationRevision) ||
      input.completedConversationRevision < 0)
  ) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export completed revision must be a non-negative integer',
    };
  }

  const hasEmptyMessage = input.messages.some((message) => message.text.trim().length === 0);
  if (hasEmptyMessage) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export messages cannot contain empty text',
    };
  }

  const hasInvalidAcknowledgment = input.messages.some(
    (message) => message.acknowledgment?.trim().length === 0
  );
  if (hasInvalidAcknowledgment) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export acknowledgments cannot be empty',
    };
  }

  const hasInvalidRevision = input.messages.some(
    (message) =>
      message.conversationRevision !== undefined &&
      (!Number.isInteger(message.conversationRevision) ||
        message.conversationRevision < 0 ||
        (input.completedConversationRevision !== undefined &&
          message.conversationRevision > input.completedConversationRevision))
  );
  if (hasInvalidRevision) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export contains a message outside the completed revision',
    };
  }

  const hasInvalidAttachment = input.messages.some((message) => {
    const attachment = message.contextAttachment;
    if (attachment === undefined) return false;
    if (attachment.capturedAt.trim().length === 0) return true;
    if (
      attachment.captureRange !== undefined &&
      (attachment.captureRange.from.trim().length === 0 ||
        attachment.captureRange.to.trim().length === 0)
    ) {
      return true;
    }
    if (
      attachment.eventRange !== undefined &&
      (attachment.eventRange.from.trim().length === 0 ||
        attachment.eventRange.to.trim().length === 0)
    ) {
      return true;
    }
    return Object.values(attachment.counts).some((count) => !Number.isInteger(count) || count < 0);
  });
  if (hasInvalidAttachment) {
    return {
      code: 'INVALID_INPUT',
      message: 'Conversation export contains an invalid context attachment summary',
    };
  }

  return null;
}

async function renderPdf(input: PdfConversationExportInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    bufferPages: true,
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
  const titleText = createDisplayTitle(input.title);

  doc.info.Title = titleText;
  doc.font(fontForText(titleText, 'bold')).fontSize(20).fillColor('#111827');
  doc.text(titleText, {
    width: contentWidth,
    align: 'left',
  });

  doc.moveDown(0.55);
  drawSectionHeading(doc, contentWidth, 'Export summary');
  drawMetadataLine(doc, contentWidth, 'Generated', formatTimestamp(input.generatedAt));
  drawMetadataLine(doc, contentWidth, 'LLM model', input.modelName);
  drawMetadataLine(doc, contentWidth, 'Assistant role', input.assistantRoleLabel);
  drawMetadataLine(doc, contentWidth, 'Initial prompt', toPlainPdfText(input.initialPrompt));
  if (input.completedConversationRevision !== undefined) {
    drawMetadataLine(
      doc,
      contentWidth,
      'Completed conversation revision',
      String(input.completedConversationRevision)
    );
  }

  doc.moveDown(0.5);
  drawSectionHeading(doc, contentWidth, 'Conversation scope');

  drawMetadataLine(
    doc,
    contentWidth,
    'Information range',
    formatDateRange(input.sourceRange.from, input.sourceRange.to)
  );
  drawMetadataLine(
    doc,
    contentWidth,
    'Effective range',
    formatDateRange(input.effectiveRange.from, input.effectiveRange.to)
  );
  drawMetadataLine(
    doc,
    contentWidth,
    'Messages taken under consideration',
    String(input.messageCounts.included)
  );
  drawMetadataLine(doc, contentWidth, 'Messages excluded', String(input.messageCounts.excluded));

  if (input.cumulativeContext !== undefined) {
    const cumulative = input.cumulativeContext;
    drawMetadataLine(doc, contentWidth, 'Context snapshots', String(cumulative.snapshotCount));
    drawMetadataLine(doc, contentWidth, 'Cumulative included', String(cumulative.counts.included));
    drawMetadataLine(doc, contentWidth, 'Cumulative omitted', String(cumulative.counts.omitted));
    drawMetadataLine(
      doc,
      contentWidth,
      'Cumulative completed transcriptions',
      String(cumulative.counts.completedTranscriptions)
    );
    drawMetadataLine(doc, contentWidth, 'Cumulative edits', String(cumulative.counts.edited));
    drawMetadataLine(
      doc,
      contentWidth,
      'Cumulative redactions',
      String(cumulative.counts.redacted + cumulative.counts.deleted)
    );
    drawMetadataLine(
      doc,
      contentWidth,
      'Cumulative reaction changes',
      String(cumulative.counts.reactionsChanged)
    );
    drawMetadataLine(
      doc,
      contentWidth,
      'Cumulative late ingested',
      String(cumulative.counts.lateIngested)
    );
  }

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
    drawMessage(
      doc,
      contentWidth,
      message.role,
      formatTimestamp(message.createdAt),
      message.text,
      input.modelName,
      input.assistantRoleLabel,
      message.contextAttachment,
      message.acknowledgment
    );
  }

  drawPageFooters(doc, titleText);
}

function drawSectionHeading(doc: PDFKit.PDFDocument, contentWidth: number, heading: string): void {
  const height = doc
    .font(fontForText(heading, 'bold'))
    .fontSize(11)
    .heightOfString(heading, { width: contentWidth });
  ensureSpace(doc, height + BLOCK_GAP);
  doc.font(fontForText(heading, 'bold')).fontSize(11).fillColor('#111827');
  doc.text(heading, { width: contentWidth, lineGap: 1 });
  doc.moveDown(0.25);
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
  const indent = 12;
  const startX = doc.page.margins.left + indent;
  const lineText = value.length > 0 ? `- ${label}: ${value}` : `- ${label}`;
  doc.font(fontForText(lineText, 'regular')).fontSize(10);
  ensureSpace(doc, doc.heightOfString(lineText, { width: contentWidth - indent }) + BLOCK_GAP);
  doc.fillColor('#4b5563');
  doc.text(lineText, startX, doc.y, {
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
  modelName: string,
  assistantRoleLabel: string,
  contextAttachment: PdfConversationExportInput['messages'][number]['contextAttachment'],
  acknowledgment: string | undefined
): void {
  const roleLabel = getMessageRoleLabel(role, modelName, assistantRoleLabel);
  const headerText = `${roleLabel} ${createdAt}`;
  const blocks = toPdfTextBlocks(text);
  const headerFont = fontForText(headerText, 'bold');
  doc.font(headerFont).fontSize(11);
  const headerHeight = doc.heightOfString(headerText, { width: contentWidth });
  ensureSpace(doc, headerHeight + 48);

  doc
    .font(headerFont)
    .fontSize(11)
    .fillColor(role === 'user' ? '#0f172a' : '#1d4ed8');
  doc.text(headerText, {
    width: contentWidth,
    lineGap: 1.5,
  });

  doc.moveDown(0.2);
  if (contextAttachment !== undefined) {
    drawContextAttachmentSummary(doc, contentWidth, contextAttachment);
    doc.moveDown(0.35);
  }
  if (acknowledgment !== undefined) {
    drawAcknowledgment(doc, contentWidth, acknowledgment);
    doc.moveDown(0.35);
  }
  drawTextBlocks(doc, contentWidth, blocks);

  doc.moveDown(0.8);
}

function drawContextAttachmentSummary(
  doc: PDFKit.PDFDocument,
  contentWidth: number,
  attachment: NonNullable<PdfConversationExportInput['messages'][number]['contextAttachment']>
): void {
  const counts = attachment.counts;
  const lines = [
    `Captured: ${formatTimestamp(attachment.capturedAt)}`,
    ...(attachment.captureRange === undefined
      ? []
      : [
          `Checked range: ${formatDateRange(
            attachment.captureRange.from,
            attachment.captureRange.to
          )}`,
        ]),
    ...(attachment.eventRange === undefined
      ? []
      : [
          `Message range: ${formatDateRange(attachment.eventRange.from, attachment.eventRange.to)}`,
        ]),
    `Included: ${String(counts.included)}`,
    `Excluded: ${String(counts.excluded)}`,
    ...(counts.completedTranscriptions === 0
      ? []
      : [`Completed transcriptions: ${String(counts.completedTranscriptions)}`]),
    ...(counts.edited === 0 ? [] : [`Edits: ${String(counts.edited)}`]),
    ...(counts.redacted + counts.deleted === 0
      ? []
      : [`Redactions: ${String(counts.redacted + counts.deleted)}`]),
    ...(counts.reactionsChanged === 0
      ? []
      : [`Reaction changes: ${String(counts.reactionsChanged)}`]),
    ...(counts.lateIngested === 0 ? [] : [`Late ingested: ${String(counts.lateIngested)}`]),
  ];
  drawSectionHeading(doc, contentWidth, 'WhatsApp context update');
  for (const line of lines) {
    drawIndentedMetadataLine(doc, contentWidth, line, '');
  }
}

function drawAcknowledgment(
  doc: PDFKit.PDFDocument,
  contentWidth: number,
  acknowledgment: string
): void {
  const heading = 'Context acknowledgment';
  drawSectionHeading(doc, contentWidth, heading);
  const plainText = toPlainPdfText(acknowledgment);
  doc.font(fontForText(plainText, 'regular')).fontSize(10).fillColor('#1f2937');
  ensureSpace(doc, doc.heightOfString(plainText, { width: contentWidth }) + BLOCK_GAP);
  doc.text(plainText, { width: contentWidth, lineGap: 1.5 });
}

function getMessageRoleLabel(
  role: 'user' | 'assistant',
  modelName: string,
  assistantRoleLabel: string
): string {
  return role === 'assistant' ? `${assistantRoleLabel} (${modelName})` : 'User';
}

function toPlainPdfText(text: string): string {
  const inlineCleaned = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizePdfGlyphs)
    .join('\n')
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
  if (/^-{3,}$/.test(trimmed)) {
    return null;
  }

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

function toPdfTextBlocks(text: string): PdfTextBlock[] {
  const blocks: PdfTextBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let tableRows: string[][] = [];
  let insideCodeFence = false;

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return;
    const paragraph = paragraphLines.join(' ').replace(/\s+/g, ' ').trim();
    if (paragraph.length > 0) {
      blocks.push(
        looksLikeSectionHeading(paragraph)
          ? { kind: 'heading', text: paragraph }
          : { kind: 'paragraph', text: paragraph }
      );
    }
    paragraphLines = [];
  };

  const flushList = (): void => {
    if (listItems.length === 0) return;
    blocks.push({ kind: 'list', items: listItems });
    listItems = [];
  };

  const flushTable = (): void => {
    if (tableRows.length === 0) return;
    blocks.push({ kind: 'table', rows: tableRows });
    tableRows = [];
  };

  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const normalizedLine = normalizePdfGlyphs(rawLine);
    const trimmed = normalizedLine.trim();
    if (/^```[A-Za-z0-9_-]*\s*$/.test(trimmed)) {
      insideCodeFence = !insideCodeFence;
      continue;
    }
    if (insideCodeFence) {
      paragraphLines.push(normalizedLine);
      continue;
    }
    if (trimmed.length === 0) {
      flushAll();
      continue;
    }
    if (/^-{3,}$/.test(trimmed)) {
      flushAll();
      continue;
    }
    if (isMarkdownTableSeparator(trimmed)) {
      continue;
    }
    const tableCells = parseMarkdownTableRow(normalizedLine);
    if (tableCells !== null) {
      flushParagraph();
      flushList();
      tableRows.push(tableCells);
      continue;
    }
    const heading = parseMarkdownHeading(trimmed);
    if (heading !== null) {
      flushAll();
      blocks.push({ kind: 'heading', text: heading });
      continue;
    }
    const listItem = parseMarkdownListItem(normalizedLine);
    if (listItem !== null) {
      flushParagraph();
      flushTable();
      listItems.push(listItem);
      continue;
    }

    flushList();
    flushTable();
    const cleaned = cleanMarkdownLine(normalizedLine) as string;
    paragraphLines.push(cleanInlineMarkdown(cleaned));
  }

  flushAll();
  return blocks.length > 0 ? blocks : [{ kind: 'paragraph', text: toPlainPdfText(text) }];
}

function drawTextBlocks(
  doc: PDFKit.PDFDocument,
  contentWidth: number,
  blocks: PdfTextBlock[]
): void {
  for (const block of blocks) {
    if (block.kind === 'heading') {
      drawMessageHeading(doc, contentWidth, block.text);
      continue;
    }
    if (block.kind === 'list') {
      drawListBlock(doc, contentWidth, block.items);
      continue;
    }
    if (block.kind === 'table') {
      drawTableBlock(doc, contentWidth, block.rows);
      continue;
    }
    drawParagraphBlock(doc, contentWidth, block.text);
  }
}

function drawMessageHeading(doc: PDFKit.PDFDocument, contentWidth: number, text: string): void {
  resetToContentLeft(doc);
  const font = fontForText(text, 'bold');
  doc.font(font).fontSize(11.5);
  ensureSpace(doc, doc.heightOfString(text, { width: contentWidth }) + BLOCK_GAP);
  doc.font(font).fontSize(11.5).fillColor('#111827');
  doc.text(text, { width: contentWidth, lineGap: 1.2 });
  doc.moveDown(0.3);
}

function drawParagraphBlock(doc: PDFKit.PDFDocument, contentWidth: number, text: string): void {
  resetToContentLeft(doc);
  const font = fontForText(text, 'regular');
  doc.font(font).fontSize(10.5);
  ensureSpace(doc, Math.min(doc.heightOfString(text, { width: contentWidth }), 72) + BLOCK_GAP);
  doc.font(font).fontSize(10.5).fillColor('#111827');
  doc.text(text, { width: contentWidth, lineGap: 2 });
  doc.moveDown(0.45);
}

function drawListBlock(doc: PDFKit.PDFDocument, contentWidth: number, items: string[]): void {
  resetToContentLeft(doc);
  const indent = 12;
  const textWidth = contentWidth - indent;
  for (const item of items) {
    const lineText = `- ${item}`;
    const font = fontForText(lineText, 'regular');
    doc.font(font).fontSize(10.5);
    ensureSpace(doc, doc.heightOfString(lineText, { width: textWidth }) + BLOCK_GAP);
    doc.font(font).fontSize(10.5).fillColor('#111827');
    doc.text(lineText, doc.page.margins.left + indent, doc.y, {
      width: textWidth,
      lineGap: 2,
    });
    doc.moveDown(0.15);
  }
  resetToContentLeft(doc);
  doc.moveDown(0.35);
}

function drawTableBlock(doc: PDFKit.PDFDocument, contentWidth: number, rows: string[][]): void {
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const columnWidth = (contentWidth - TABLE_CELL_GAP * (columnCount - 1)) / columnCount;
  resetToContentLeft(doc);

  rows.forEach((row, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_value, index) => row[index] ?? '');
    const cellHeights = cells.map((cell) => {
      const font = fontForText(cell, rowIndex === 0 ? 'bold' : 'regular');
      doc.font(font).fontSize(9.5);
      return doc.heightOfString(cell, { width: columnWidth - TABLE_CELL_PADDING * 2 });
    });
    const rowHeight = Math.max(...cellHeights, 12) + TABLE_CELL_PADDING * 2;
    ensureSpace(doc, rowHeight + 2);
    const y = doc.y;
    if (rowIndex === 0) {
      doc.save().rect(doc.page.margins.left, y, contentWidth, rowHeight).fill('#f3f4f6').restore();
    }
    cells.forEach((cell, cellIndex) => {
      const x =
        doc.page.margins.left + cellIndex * (columnWidth + TABLE_CELL_GAP) + TABLE_CELL_PADDING;
      const font = fontForText(cell, rowIndex === 0 ? 'bold' : 'regular');
      doc.font(font).fontSize(9.5).fillColor('#111827');
      doc.text(cell, x, y + TABLE_CELL_PADDING, {
        width: columnWidth - TABLE_CELL_PADDING * 2,
        lineGap: 1.2,
      });
    });
    doc
      .save()
      .lineWidth(0.5)
      .strokeColor('#e5e7eb')
      .moveTo(doc.page.margins.left, y + rowHeight)
      .lineTo(doc.page.margins.left + contentWidth, y + rowHeight)
      .stroke()
      .restore();
    doc.y = y + rowHeight + 2;
    resetToContentLeft(doc);
  });
  doc.moveDown(0.5);
}

function parseMarkdownHeading(line: string): string | null {
  const match = /^(#{1,6})\s+(.+)$/.exec(line);
  return match?.[2] !== undefined ? cleanInlineMarkdown(match[2]).trim() : null;
}

function parseMarkdownListItem(line: string): string | null {
  const match = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
  return match?.[1] !== undefined ? cleanInlineMarkdown(match[1]).trim() : null;
}

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return null;
  }
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cleanInlineMarkdown(cell).trim())
    .filter((cell) => cell.length > 0);
  return cells.length >= 2 ? cells : null;
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function cleanInlineMarkdown(text: string): string {
  return normalizePdfGlyphs(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeSectionHeading(text: string): boolean {
  if (text.length > 96 || text.endsWith('.')) {
    return false;
  }
  if (text.endsWith(':')) {
    return true;
  }
  return /^(Co wiadomo|What is known|Profil|Profile|Struktura|Mechanizmy|Potrzeby|Teoretyczne|Horyzont|Poziom|Dynamika|Typ relacji|Główne osie|Ograniczenia|Brak danych)/i.test(
    text
  );
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

function resetToContentLeft(doc: PDFKit.PDFDocument): void {
  doc.x = doc.page.margins.left;
}

function fontForText(text: string, weight: 'regular' | 'bold'): string {
  if (/[\u0080-\uFFFF]/.test(text)) {
    return weight === 'bold' ? UNICODE_BOLD_FONT : UNICODE_REGULAR_FONT;
  }

  return weight === 'bold' ? STANDARD_BOLD_FONT : STANDARD_REGULAR_FONT;
}

function createBaseFileName(title: string): string {
  const sanitizedTitle = sanitizeTitle(maskSensitiveText(toPlainPdfText(title)));
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
  const label = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return label.length === 0
    ? 'Other'
    : `${label.charAt(0).toUpperCase()}${label.slice(1).toLowerCase()}`;
}

function createDisplayTitle(title: string): string {
  const plainTitle = toPlainPdfText(title) || FALLBACK_FILE_NAME;
  return maskSensitiveText(plainTitle);
}

function maskSensitiveText(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{7,}\d/g, (value) => maskPhoneLikeValue(value));
}

function maskPhoneLikeValue(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) {
    return value;
  }
  const visiblePrefix = digits.slice(0, Math.min(3, digits.length));
  const visibleSuffix = digits.slice(-2);
  const hiddenLength = Math.max(digits.length - visiblePrefix.length - visibleSuffix.length, 3);
  const plusPrefix = value.trim().startsWith('+') ? '+' : '';
  return `${plusPrefix}${visiblePrefix}${'*'.repeat(hiddenLength)}${visibleSuffix}`;
}

function formatDateRange(from: string, to: string): string {
  return `${formatTimestamp(from)} - ${formatTimestamp(to)}`;
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return normalizePdfGlyphs(value);
  }
  const date = new Date(parsed);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

function normalizePdfGlyphs(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[–—]/g, ' - ')
    .replace(/[→⇒➜➔]/g, '->')
    .replace(/[↔⟷]/g, '<->')
    .replace(/[\u{1f300}-\u{1faff}\u{2600}-\u{27bf}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trimEnd();
}

function drawPageFooters(doc: PDFKit.PDFDocument, title: string): void {
  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const pageNumber = pageIndex - range.start + 1;
    const footer = `${title} | Page ${String(pageNumber)} of ${String(range.count)}`;
    doc.font(fontForText(footer, 'regular')).fontSize(8).fillColor('#6b7280');
    doc.text(footer, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 20, {
      width: getContentWidth(doc),
      align: 'center',
      lineBreak: false,
    });
  }
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
