/**
 * Strip markdown formatting from text for clean display.
 * Handles bold, italic, headers, code markers, links, and surrounding quotes.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove markdown links, keep text
    .replace(/\*\*/g, '') // Remove bold markers
    .replace(/__/g, '') // Remove bold (underscore)
    .replace(/(?<!\*)\*(?!\*)/g, '') // Remove italic markers (single asterisk)
    .replace(/(?<!_)_(?!_)/g, '') // Remove italic (single underscore)
    .replace(/^\s*#+\s*/gm, '') // Remove headers (with optional leading whitespace)
    .replace(/`/g, '') // Remove code markers
    .replace(/^["']|["']$/g, '') // Remove surrounding quotes
    .trim();
}
