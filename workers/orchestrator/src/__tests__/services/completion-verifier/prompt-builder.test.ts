import { describe, expect, it } from 'vitest';
import { resumeSummaryPrompt } from '../../../services/completion-verifier/prompt-builder.js';

describe('resumeSummaryPrompt', () => {
  it('has correct metadata', () => {
    expect(resumeSummaryPrompt.name).toBe('resume-summary');
    expect(resumeSummaryPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('includes the transcript at the end of the prompt', () => {
    const out = resumeSummaryPrompt.build({ transcript: 'UNIQUE_TRANSCRIPT_MARKER' });
    expect(out.endsWith('UNIQUE_TRANSCRIPT_MARKER')).toBe(true);
  });

  it('pins length and boundary anchors', () => {
    const T = 'TRANSCRIPT_MARKER';
    const p = resumeSummaryPrompt.build({ transcript: T });
    expect(p.length).toBe(754);
    expect(p.startsWith('You are summarizing the output of a resumed code-worker session.')).toBe(
      true
    );
    expect(p.endsWith(`Transcript (last 20 lines):\n${T}`)).toBe(true);
    expect(p).toContain('- summary: concise bullet-point summary');
  });

  it('returns ONLY-JSON instruction', () => {
    const p = resumeSummaryPrompt.build({ transcript: '' });
    expect(p).toContain('Return ONLY a JSON object');
  });
});
