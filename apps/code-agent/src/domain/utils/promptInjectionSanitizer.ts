/**
 * Prompt injection sanitization for code-agent inputs.
 *
 * INT-413: Complementary layer to promptSanitization.ts (secret redaction).
 * Runs AFTER secret redaction. Strips system keywords, control characters,
 * HTML-encodes special chars, and rejects known-malicious patterns.
 *
 * Pure function with no external dependencies.
 */

import { ok, err, type Result } from '@intexuraos/common-core';

interface SanitizeInjectionError { code: 'empty_prompt' | 'base64_blob_detected'; message: string }
type SanitizeInjectionResult = Result<string, SanitizeInjectionError>;

/**
 * Minimum run of base64 characters that triggers blob detection.
 * Raised to 3000 to avoid false positives on short encoded values.
 */
const BASE64_THRESHOLD = 3000;

/**
 * Pattern matching a suspicious run of base64 characters.
 */
const BASE64_BLOB_PATTERN = new RegExp(`[A-Za-z0-9+/=]{${String(BASE64_THRESHOLD)},}`);

/**
 * System/injection keyword patterns — case-insensitive.
 * Matches LLaMA-style, OpenAI chat-ML, and generic override markers.
 */
const SYSTEM_KEYWORD_PATTERN =
  /\[SYSTEM|\[MANDATORY|\[INSTRUCTION|<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|<<SYS>>|<<\/SYS>>/gi;

/**
 * Control characters to strip: U+0000–U+0008, U+000B–U+000C, U+000E–U+001F.
 * Preserves: \t (U+0009), \n (U+000A), \r (U+000D).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/**
 * Encode the 5 HTML special characters inline — no external library.
 */
function encodeHtmlEntities(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize a prompt for injection attacks.
 *
 * Pipeline (in order):
 * 1. Reject if empty
 * 2. Reject if base64 blob detected
 * 3. Strip system-override keywords
 * 4. Remove dangerous control characters (preserving \t, \n, \r)
 * 5. HTML-encode special characters
 * 6. Limit consecutive newlines to 4
 * 7. Re-check for empty after transformations
 *
 * @param prompt - Prompt after secret redaction (output of sanitizePrompt)
 * @returns Result with sanitized string or structured error
 */
export function sanitizePromptForInjection(prompt: string): SanitizeInjectionResult {
  // Step 1: Reject empty
  if (prompt.trim().length === 0) {
    return err({ code: 'empty_prompt', message: 'Prompt is empty' });
  }

  // Step 2: Reject base64 blobs
  if (BASE64_BLOB_PATTERN.test(prompt)) {
    return err({ code: 'base64_blob_detected', message: 'Prompt contains a base64 blob and was rejected' });
  }

  let result = prompt;

  // Step 3: Strip system-override keywords
  result = result.replace(SYSTEM_KEYWORD_PATTERN, '');

  // Step 4: Remove dangerous control characters
  result = result.replace(CONTROL_CHAR_PATTERN, '');

  // Step 5: HTML-encode special characters
  result = encodeHtmlEntities(result);

  // Step 6: Limit consecutive newlines to 4
  result = result.replace(/\n{5,}/g, '\n\n\n\n');

  // Step 7: Re-check for empty after transformations
  if (result.trim().length === 0) {
    return err({ code: 'empty_prompt', message: 'Prompt is empty after sanitization' });
  }

  return ok(result);
}
