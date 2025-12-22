/**
 * Text chunking utilities for Notion API.
 * Notion has a 2000-character limit per rich_text block.
 * This module provides intelligent text splitting that respects content boundaries.
 */

/**
 * Maximum characters per Notion text block.
 * Notion API limit is 2000 characters per rich_text element.
 */
export const NOTION_TEXT_BLOCK_LIMIT = 2000;

/**
 * Safety margin to avoid edge cases with Unicode characters.
 */
const SAFETY_MARGIN = 50;

/**
 * Effective maximum chunk size.
 */
const MAX_CHUNK_SIZE = NOTION_TEXT_BLOCK_LIMIT - SAFETY_MARGIN;

/**
 * Split text into chunks that fit within Notion's text block limit.
 * Splits intelligently at paragraph, sentence, or word boundaries.
 *
 * @param text - The text to split
 * @param maxChunkSize - Maximum size per chunk (default: 1950)
 * @returns Array of text chunks, each under the limit
 */
export function splitTextIntoChunks(text: string, maxChunkSize: number = MAX_CHUNK_SIZE): string[] {
  // Empty or short text doesn't need splitting
  if (text.length === 0) {
    return [''];
  }

  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    // Find the best split point within the limit
    const splitPoint = findBestSplitPoint(remaining, maxChunkSize);
    const chunk = remaining.substring(0, splitPoint).trimEnd();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    remaining = remaining.substring(splitPoint).trimStart();
  }

  return chunks.length > 0 ? chunks : [''];
}

/**
 * Find the best point to split text, preferring natural boundaries.
 * Priority: paragraph break > sentence end > word boundary > hard cut
 */
function findBestSplitPoint(text: string, maxLength: number): number {
  // Look for paragraph break (double newline)
  const paragraphBreak = findLastOccurrence(text, /\n\s*\n/g, maxLength);
  if (paragraphBreak > maxLength * 0.5) {
    return paragraphBreak;
  }

  // Look for single newline
  const lineBreak = findLastOccurrence(text, /\n/g, maxLength);
  if (lineBreak > maxLength * 0.5) {
    return lineBreak;
  }

  // Look for sentence end (. ! ? followed by space or end)
  const sentenceEnd = findLastOccurrence(text, /[.!?]\s+/g, maxLength);
  if (sentenceEnd > maxLength * 0.3) {
    return sentenceEnd;
  }

  // Look for clause boundary (comma, semicolon, colon followed by space)
  const clauseEnd = findLastOccurrence(text, /[,;:]\s+/g, maxLength);
  if (clauseEnd > maxLength * 0.3) {
    return clauseEnd;
  }

  // Look for word boundary (space)
  const wordEnd = text.lastIndexOf(' ', maxLength);
  if (wordEnd > maxLength * 0.2) {
    return wordEnd + 1; // Include the space in the current chunk
  }

  // Hard cut at maxLength as last resort
  return maxLength;
}

/**
 * Find the last occurrence of a pattern within a maximum position.
 * Returns the position after the match (where to split).
 */
function findLastOccurrence(text: string, pattern: RegExp, maxPosition: number): number {
  let lastEnd = -1;
  let match: RegExpExecArray | null;

  // Reset regex state
  pattern.lastIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    const matchEnd = match.index + match[0].length;
    if (matchEnd <= maxPosition) {
      lastEnd = matchEnd;
    } else {
      break;
    }
  }

  return lastEnd;
}

/**
 * Join text chunks back into a single string.
 * Handles potential whitespace issues at boundaries.
 */
export function joinTextChunks(chunks: string[]): string {
  if (chunks.length === 0) {
    return '';
  }

  const firstChunk = chunks[0];
  if (chunks.length === 1 && firstChunk !== undefined) {
    return firstChunk;
  }

  // Join with newline if chunks don't already have proper separation
  const filtered = chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);

  return filtered.length > 0 ? filtered.join('\n') : '';
}

/**
 * Check if text exceeds the Notion block limit.
 */
export function exceedsNotionLimit(text: string): boolean {
  return text.length > NOTION_TEXT_BLOCK_LIMIT;
}

/**
 * Get the number of chunks needed for a text.
 */
export function getRequiredChunkCount(text: string): number {
  return splitTextIntoChunks(text).length;
}
