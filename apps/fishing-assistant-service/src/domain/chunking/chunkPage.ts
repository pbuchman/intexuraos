import { classifyPage } from './classifyPage.js';
import { inferTitle } from './inferTitle.js';
import { normalizePageText } from './normalizePageText.js';
import type { ChunkPageInput, ChunkPageResult, FishingContentType, PageChunk } from './types.js';

const TARGET_CHUNK_MIN = 800;
const MAX_CHUNK_CHARS = 1600;
const OVERLAP_CHARS = 140;

interface Section {
  heading: string | null;
  text: string;
}

function nextMeaningfulLine(lines: readonly string[], startIndex: number): string | null {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && line.trim().length > 0) return line.trim();
  }
  return null;
}

function isHeading(line: string, nextLine: string | null): boolean {
  if (line.startsWith('- ')) return false;
  if (line.endsWith(':')) return true;
  return line.length <= 90 && nextLine?.startsWith('- ') === true;
}

function splitIntoSections(normalizedText: string, title: string): Section[] {
  const lines = normalizedText.split('\n');
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  let introLines: string[] = [];
  let skippedTitle = false;

  const flush = (): void => {
    const text = currentLines.join('\n').trim();
    if (currentHeading !== null && text.length > 0) {
      sections.push({ heading: currentHeading, text });
    }
    currentLines = [];
  };

  for (const [i, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!skippedTitle && line === title) {
      skippedTitle = true;
      continue;
    }
    if (line.length === 0) {
      if (currentHeading !== null && currentLines.length > 0) currentLines.push('');
      continue;
    }

    const nextLine = nextMeaningfulLine(lines, i + 1);
    if (isHeading(line, nextLine)) {
      flush();
      currentHeading = line;
      if (introLines.length > 0) {
        currentLines.push(...introLines, '');
        introLines = [];
      }
      continue;
    }

    if (currentHeading === null) {
      introLines.push(line);
    } else {
      currentLines.push(line);
    }
  }
  flush();

  const fallbackText = introLines.join('\n').trim();
  if (sections.length === 0 && fallbackText.length > 0) {
    sections.push({ heading: null, text: fallbackText });
  }
  return sections;
}

function findSplitIndex(text: string, maxChars: number): number {
  const window = text.slice(0, maxChars + 1);
  const sentenceBoundary = Math.max(
    window.lastIndexOf('. ', maxChars),
    window.lastIndexOf('! ', maxChars),
    window.lastIndexOf('? ', maxChars),
    window.lastIndexOf('\n\n', maxChars)
  );
  if (sentenceBoundary >= TARGET_CHUNK_MIN) return sentenceBoundary + 1;

  const newlineBoundary = window.lastIndexOf('\n', maxChars);
  if (newlineBoundary >= TARGET_CHUNK_MIN) return newlineBoundary;

  const spaceBoundary = window.lastIndexOf(' ', maxChars);
  if (spaceBoundary >= TARGET_CHUNK_MIN) return spaceBoundary;

  return maxChars;
}

function overlapPrefix(previousChunk: string): string {
  const tail = previousChunk.slice(-OVERLAP_CHARS).trimStart();
  const sentenceStart = Math.min(
    ...['. ', '! ', '? ']
      .map((marker) => tail.indexOf(marker))
      .filter((index) => index >= 0)
      .map((index) => index + 2)
  );
  if (Number.isFinite(sentenceStart) && sentenceStart > 0 && sentenceStart < tail.length) {
    return tail.slice(sentenceStart);
  }
  return tail;
}

function splitSectionText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > MAX_CHUNK_CHARS) {
    const splitIndex = findSplitIndex(remaining, MAX_CHUNK_CHARS);
    const chunk = remaining.slice(0, splitIndex).trim();
    chunks.push(chunk);
    const overlap = overlapPrefix(chunk);
    remaining = `${overlap} ${remaining.slice(splitIndex).trim()}`.trim();
  }

  chunks.push(remaining);
  return chunks;
}

function buildSearchableText(input: {
  folderPath: readonly string[];
  title: string;
  heading: string | null;
  text: string;
}): string {
  const parts: string[] = [];
  if (input.folderPath.length > 0) parts.push(`Folder: ${input.folderPath.join(' > ')}`);
  parts.push(`Page: ${input.title}`);
  if (input.heading !== null) parts.push(`Heading: ${input.heading}`);
  parts.push(input.text);
  return parts.join('\n');
}

function buildChunks(input: {
  sections: readonly Section[];
  folderPath: readonly string[];
  title: string;
  contentType: FishingContentType;
}): PageChunk[] {
  const chunks: PageChunk[] = [];
  for (const section of input.sections) {
    for (const text of splitSectionText(section.text)) {
      chunks.push({
        index: chunks.length,
        heading: section.heading,
        text,
        searchableText: buildSearchableText({
          folderPath: input.folderPath,
          title: input.title,
          heading: section.heading,
          text,
        }),
        charCount: text.length,
        contentType: input.contentType,
      });
    }
  }
  return chunks;
}

export async function chunkPage(input: ChunkPageInput): Promise<ChunkPageResult> {
  const normalizedText = normalizePageText(input.rawText);
  const titleInference = input.titleInference;
  const titleOptions =
    titleInference === undefined
      ? {}
      : {
          generateTitle: async (content: string): Promise<string> =>
            await titleInference.generateTitle(content),
        };
  const title = await inferTitle(normalizedText, titleOptions);
  const contentType = classifyPage(normalizedText, title);
  const sections = splitIntoSections(normalizedText, title);

  return {
    title,
    normalizedText,
    contentType,
    chunks: buildChunks({
      sections,
      folderPath: input.folderPath ?? [],
      title,
      contentType,
    }),
  };
}
