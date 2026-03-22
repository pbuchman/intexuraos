/**
 * Escapes XML-like tags in user input to prevent prompt injection.
 */
export function escapeXmlTags(input: string): string {
  return input.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
