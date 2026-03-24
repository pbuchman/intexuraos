/**
 * Markdown to Notion Blocks Converter
 *
 * Converts markdown text to Notion API block objects.
 * Supports: headings, paragraphs, bold, italic, lists, tables, code blocks.
 */

// ============================================================================
// Types
// ============================================================================

interface RichTextSegment {
  type: 'text';
  text: { content: string; link?: { url: string } };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
  };
}

type NotionLanguage = 'plain text' | 'javascript' | 'typescript' | 'python' | 'java' | 'markdown' | 'json' | 'html' | 'css' | 'bash' | 'sql';

type NotionBlock =
  | {
      object: 'block';
      type: 'heading_1';
      heading_1: { rich_text: RichTextSegment[] };
    }
  | {
      object: 'block';
      type: 'heading_2';
      heading_2: { rich_text: RichTextSegment[] };
    }
  | {
      object: 'block';
      type: 'heading_3';
      heading_3: { rich_text: RichTextSegment[] };
    }
  | {
      object: 'block';
      type: 'paragraph';
      paragraph: { rich_text: RichTextSegment[] };
    }
  | {
      object: 'block';
      type: 'bulleted_list_item';
      bulleted_list_item: { rich_text: RichTextSegment[] };
    }
  | {
      object: 'block';
      type: 'numbered_list_item';
      numbered_list_item: { rich_text: RichTextSegment[] };
    }
  | {
      object: 'block';
      type: 'code';
      code: { rich_text: RichTextSegment[]; language: NotionLanguage };
    }
  | {
      object: 'block';
      type: 'image';
      image: { type: 'external'; external: { url: string }; caption?: RichTextSegment[] };
    }
  | {
      object: 'block';
      type: 'table';
      table: { table_width: number; has_column_header: boolean; has_row_header: boolean; children: TableRowBlock[] };
    }
  | TableRowBlock;

interface TableRowBlock {
  object: 'block';
  type: 'table_row';
  table_row: { cells: RichTextSegment[][] };
}

// ============================================================================
// Rich text parsing (inline formatting)
// ============================================================================

function parseInlineFormatting(text: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold: **text** or __text__
    const boldMatch = /^(\*\*|__)(.+?)\1/.exec(remaining);
    if (boldMatch?.[2] !== undefined) {
      segments.push({
        type: 'text',
        text: { content: boldMatch[2] },
        annotations: { bold: true },
      });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text* or _text_ (but not ** or __)
    const italicMatch = /^(\*|_)(?!\1)(.+?)\1(?!\1)/.exec(remaining);
    if (italicMatch?.[2] !== undefined) {
      segments.push({
        type: 'text',
        text: { content: italicMatch[2] },
        annotations: { italic: true },
      });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code: `text`
    const codeMatch = /^`([^`]+)`/.exec(remaining);
    if (codeMatch?.[1] !== undefined) {
      segments.push({
        type: 'text',
        text: { content: codeMatch[1] },
        annotations: { code: true },
      });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Link: [text](url)
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(remaining);
    if (linkMatch?.[1] !== undefined && linkMatch[2] !== undefined) {
      segments.push({
        type: 'text',
        text: { content: linkMatch[1], link: { url: linkMatch[2] } },
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text: consume until next special character
    const plainMatch = /^[^*_`[]+/.exec(remaining);
    if (plainMatch !== null) {
      segments.push({
        type: 'text',
        text: { content: plainMatch[0] },
      });
      remaining = remaining.slice(plainMatch[0].length);
      continue;
    }

    // Single special character that's not part of formatting
    // Loop condition guarantees remaining has at least 1 character
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires ?? fallback; loop condition guarantees remaining[0] is defined @preserve */
    const char = remaining[0] ?? '';
    /* v8 ignore stop @preserve */
    segments.push({
      type: 'text',
      text: { content: char },
    });
    remaining = remaining.slice(1);
  }

  /* v8 ignore start -- ts-type: ternary fallback is defensive @preserve */
  return segments.length > 0 ? segments : [{ type: 'text', text: { content: '' } }];
  /* v8 ignore stop @preserve */
}

// ============================================================================
// Table parsing
// ============================================================================

function parseTable(lines: string[]): { block: NotionBlock; linesConsumed: number } | null {
  // Need at least header + separator
  if (lines.length < 2) return null;

  // Length check guarantees these exist
  const firstLine = lines[0];
  const secondLine = lines[1];
  /* v8 ignore start -- ts-type: array access guaranteed by length check above @preserve */
  if (firstLine === undefined || secondLine === undefined) return null;
  /* v8 ignore stop @preserve */

  // Check separator format
  if (!/^\|?[\s-:|]+\|?$/.test(secondLine)) return null;

  // Collect table lines: header at 0, skip separator at 1, data rows from 2+
  const tableLines: string[] = [firstLine];
  let linesConsumed = 2; // header + separator
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard for array element within loop bounds @preserve */
    if (line === undefined) break;
    /* v8 ignore stop @preserve */
    if (!line.includes('|')) break;
    tableLines.push(line);
    linesConsumed++;
  }

  // Parse cells from each table line
  const rows: RichTextSegment[][][] = tableLines.map((line) => {
    // For lines with leading |, split and take middle cells
    // For lines without leading |, split directly
    const rawCells = line.startsWith('|')
      ? line.split('|').slice(1, -1)
      : line.split('|');

    return rawCells
      .map((cell) => cell.trim())
      .filter((cell) => cell !== '')
      .map((cell) => parseInlineFormatting(cell));
  });

  // rows is mapped from tableLines which has at least 1 element
  const firstRow = rows[0];
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard — rows always has at least one element @preserve */
  if (firstRow === undefined) return null;
  /* v8 ignore stop @preserve */

  const tableWidth = firstRow.length;

  // Normalize all rows to same width
  const normalizedRows = rows.map((row) => {
    while (row.length < tableWidth) {
      row.push([{ type: 'text', text: { content: '' } }]);
    }
    return row.slice(0, tableWidth);
  });

  const children: TableRowBlock[] = normalizedRows.map((row) => ({
    object: 'block' as const,
    type: 'table_row' as const,
    table_row: { cells: row },
  }));

  return {
    block: {
      object: 'block' as const,
      type: 'table' as const,
      table: {
        table_width: tableWidth,
        has_column_header: true,
        has_row_header: false,
        children,
      },
    },
    linesConsumed,
  };
}

// ============================================================================
// Code block parsing
// ============================================================================

function mapLanguage(lang: string): NotionLanguage {
  const langMap: Record<string, NotionLanguage> = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
  };
  const normalized = lang.toLowerCase();
  if (normalized in langMap) {
    return langMap[normalized] as NotionLanguage;
  }
  const validLanguages: NotionLanguage[] = ['javascript', 'typescript', 'python', 'java', 'markdown', 'json', 'html', 'css', 'bash', 'sql'];
  if (validLanguages.includes(normalized as NotionLanguage)) {
    return normalized as NotionLanguage;
  }
  return 'plain text';
}

function parseCodeBlock(lines: string[], startIndex: number): { block: NotionBlock; linesConsumed: number } | null {
  const firstLine = lines[startIndex];
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires undefined check; startIndex validated by caller to be within bounds @preserve */
  if (firstLine === undefined) return null;
  /* v8 ignore stop @preserve */

  const openMatch = /^```(\w*)$/.exec(firstLine);
  if (openMatch === null) return null;

  /* v8 ignore start -- regex: regex capture group guarantees value, fallback is defensive @preserve */
  const language = mapLanguage(openMatch[1] ?? '');
  /* v8 ignore stop @preserve */
  const codeLines: string[] = [];
  let i = startIndex + 1;

  for (; i < lines.length; i++) {
    const line = lines[i];
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard for array element within loop bounds @preserve */
    if (line === undefined) break;
    /* v8 ignore stop @preserve */
    if (line === '```') {
      i++;
      break;
    }
    codeLines.push(line);
  }

  const content = codeLines.join('\n');

  return {
    block: {
      object: 'block' as const,
      type: 'code' as const,
      code: {
        rich_text: [{ type: 'text' as const, text: { content } }],
        language,
      },
    },
    linesConsumed: i - startIndex,
  };
}

// ============================================================================
// Main conversion function
// ============================================================================

const MAX_TEXT_LENGTH = 1900;

function splitLongText(text: string): string[] {
  if (text.length <= MAX_TEXT_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_TEXT_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitPoint = remaining.lastIndexOf(' ', MAX_TEXT_LENGTH);
    if (splitPoint < MAX_TEXT_LENGTH * 0.5) {
      splitPoint = MAX_TEXT_LENGTH;
    }

    chunks.push(remaining.slice(0, splitPoint).trimEnd());
    remaining = remaining.slice(splitPoint).trimStart();
  }

  return chunks;
}

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires undefined check; loop bounds guarantee array access is valid @preserve */
    if (line === undefined) {
    /* v8 ignore stop @preserve */
      i++;
      continue;
    }

    // Empty line - skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const result = parseCodeBlock(lines, i);
      if (result !== null) {
        blocks.push(result.block);
        i += result.linesConsumed;
        continue;
      }
    }

    // Table (check if current line and next could be a table)
    if (line.includes('|')) {
      const remainingLines = lines.slice(i);
      const tableResult = parseTable(remainingLines);
      if (tableResult !== null) {
        blocks.push(tableResult.block);
        i += tableResult.linesConsumed;
        continue;
      }
    }

    // Headings
    const h1Match = /^#\s+(.+)$/.exec(line);
    if (h1Match?.[1] !== undefined) {
      blocks.push({
        object: 'block' as const,
        type: 'heading_1' as const,
        heading_1: { rich_text: parseInlineFormatting(h1Match[1]) },
      });
      i++;
      continue;
    }

    const h2Match = /^##\s+(.+)$/.exec(line);
    if (h2Match?.[1] !== undefined) {
      blocks.push({
        object: 'block' as const,
        type: 'heading_2' as const,
        heading_2: { rich_text: parseInlineFormatting(h2Match[1]) },
      });
      i++;
      continue;
    }

    const h3Match = /^###\s+(.+)$/.exec(line);
    if (h3Match?.[1] !== undefined) {
      blocks.push({
        object: 'block' as const,
        type: 'heading_3' as const,
        heading_3: { rich_text: parseInlineFormatting(h3Match[1]) },
      });
      i++;
      continue;
    }

    // Bulleted list
    const bulletMatch = /^[\s]*[-*]\s+(.+)$/.exec(line);
    if (bulletMatch?.[1] !== undefined) {
      const textChunks = splitLongText(bulletMatch[1]);
      for (const chunk of textChunks) {
        blocks.push({
          object: 'block' as const,
          type: 'bulleted_list_item' as const,
          bulleted_list_item: { rich_text: parseInlineFormatting(chunk) },
        });
      }
      i++;
      continue;
    }

    // Numbered list
    const numberedMatch = /^[\s]*\d+\.\s+(.+)$/.exec(line);
    if (numberedMatch?.[1] !== undefined) {
      const textChunks = splitLongText(numberedMatch[1]);
      for (const chunk of textChunks) {
        blocks.push({
          object: 'block' as const,
          type: 'numbered_list_item' as const,
          numbered_list_item: { rich_text: parseInlineFormatting(chunk) },
        });
      }
      i++;
      continue;
    }

    // Image: ![alt](url)
    const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (imageMatch !== null) {
      /* v8 ignore start -- regex: regex capture groups guaranteed by match; ?? is defensive fallback for noUncheckedIndexedAccess @preserve */
      const alt = imageMatch[1] ?? '';
      const url = imageMatch[2] ?? '';
      /* v8 ignore stop @preserve */
      /* v8 ignore start -- upstream: regex capture group [^)]+ guarantees url is always non-empty @preserve */
      if (url !== '') {
      /* v8 ignore stop @preserve */
        const imageBlock: NotionBlock = {
          object: 'block' as const,
          type: 'image' as const,
          image: {
            type: 'external' as const,
            external: { url },
            ...(alt !== '' && { caption: [{ type: 'text' as const, text: { content: alt } }] }),
          },
        };
        blocks.push(imageBlock);
        i++;
        continue;
      }
    }

    // Regular paragraph
    const textChunks = splitLongText(line);
    for (const chunk of textChunks) {
      blocks.push({
        object: 'block' as const,
        type: 'paragraph' as const,
        paragraph: { rich_text: parseInlineFormatting(chunk) },
      });
    }
    i++;
  }

  return blocks;
}

export type { NotionBlock, RichTextSegment };
