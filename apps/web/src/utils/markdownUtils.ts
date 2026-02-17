/**
 * Strip markdown formatting from text for clean display.
 * Handles bold, italic, headers, code markers, links, and surrounding quotes.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\\([[\]*#~>_!`()\\])/g, '$1')
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

/**
 * Strip HTML tags from text for clean display.
 * Preserves the text content, removes all HTML elements.
 */
export function stripHtmlTags(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
