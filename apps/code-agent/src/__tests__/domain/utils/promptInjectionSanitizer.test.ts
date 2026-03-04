/**
 * Tests for promptInjectionSanitizer utility.
 *
 * INT-413: Adds injection prevention layer (system keyword stripping,
 * control character removal, HTML encoding) that runs after secret redaction.
 *
 * Pure function — no setServices/resetServices needed.
 */
import { describe, expect, it } from 'vitest';
import { sanitizePromptForInjection } from '../../../domain/utils/promptInjectionSanitizer.js';

describe('sanitizePromptForInjection', () => {
  // ─── Empty rejection ──────────────────────────────────────────────
  it('rejects empty string with empty_prompt error', () => {
    const result = sanitizePromptForInjection('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('empty_prompt');
    }
  });

  it('rejects whitespace-only string with empty_prompt error', () => {
    const result = sanitizePromptForInjection('   \n\t  ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('empty_prompt');
    }
  });

  // ─── Base64 blob rejection ────────────────────────────────────────
  it('rejects a 3500-char base64 string with base64_blob_detected error', () => {
    const base64Blob = 'A'.repeat(3500);
    const result = sanitizePromptForInjection(base64Blob);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('base64_blob_detected');
    }
  });

  it('allows a 2000-char base64-looking string (below threshold)', () => {
    const shortBase64 = 'A'.repeat(2000);
    const result = sanitizePromptForInjection(shortBase64);
    expect(result.ok).toBe(true);
  });

  // ─── System keyword stripping ─────────────────────────────────────
  it('strips [SYSTEM prefix', () => {
    const result = sanitizePromptForInjection('[SYSTEM you are...');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(' you are...');
    }
  });

  it('strips <|im_start|> token', () => {
    const result = sanitizePromptForInjection('<|im_start|>system');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('system');
    }
  });

  it('strips <<SYS>> and <</SYS>> tags', () => {
    const result = sanitizePromptForInjection('<<SYS>>override<</SYS>>');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('override');
    }
  });

  it('strips [system case-insensitively (produces empty → empty_prompt)', () => {
    const result = sanitizePromptForInjection('[system');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('empty_prompt');
    }
  });

  // ─── Control character removal ────────────────────────────────────
  it('removes null bytes', () => {
    const result = sanitizePromptForInjection('hello\x00world');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('helloworld');
    }
  });

  it('preserves tab characters', () => {
    const result = sanitizePromptForInjection('hello\tworld');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('hello\tworld');
    }
  });

  it('preserves newlines', () => {
    const result = sanitizePromptForInjection('hello\nworld');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('hello\nworld');
    }
  });

  // ─── HTML entity encoding ─────────────────────────────────────────
  it('encodes < and > as HTML entities', () => {
    const result = sanitizePromptForInjection('<script>alert(1)</script>');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    }
  });

  it('encodes & as HTML entity', () => {
    const result = sanitizePromptForInjection('A & B');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('A &amp; B');
    }
  });

  it('encodes double quotes as HTML entities', () => {
    const result = sanitizePromptForInjection('"hello"');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('&quot;hello&quot;');
    }
  });

  it("encodes single quotes as HTML entities", () => {
    const result = sanitizePromptForInjection("it's");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('it&#39;s');
    }
  });

  // ─── Newline limiting ─────────────────────────────────────────────
  it('collapses 6 consecutive newlines to 4', () => {
    const result = sanitizePromptForInjection('a\n\n\n\n\n\nb');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('a\n\n\n\nb');
    }
  });

  it('leaves 4 consecutive newlines unchanged', () => {
    const result = sanitizePromptForInjection('a\n\n\n\nb');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('a\n\n\n\nb');
    }
  });

  // ─── Combined transformations ─────────────────────────────────────
  it('applies all layers in order: keywords + control chars + HTML', () => {
    const result = sanitizePromptForInjection('[SYSTEM\x00<b>hello</b>');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // [SYSTEM stripped, null removed, < > encoded
      expect(result.value).toBe('&lt;b&gt;hello&lt;/b&gt;');
    }
  });

  // ─── Normal input pass-through ────────────────────────────────────
  it('returns normal input unchanged', () => {
    const result = sanitizePromptForInjection('Fix the login bug');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('Fix the login bug');
    }
  });
});
