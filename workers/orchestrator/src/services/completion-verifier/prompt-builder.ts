/**
 * Prompt builder for the resume-summary LLM helper — the only remaining
 * LLM-backed path in the completion-verifier module. The legacy
 * verification-extraction prompts (planning / execution / review / etc.)
 * were removed alongside the LLM verifier in INT-1470; the deterministic
 * block-parser is the sole verification path.
 */

import type { PromptBuilder } from '../prompt-builder.js';

export interface ResumeSummaryPromptInput {
  transcript: string;
}

export const resumeSummaryPrompt: PromptBuilder<ResumeSummaryPromptInput> = {
  name: 'resume-summary',
  description: 'Summarizes the transcript of a resumed code-worker session into a JSON object',
  version: '1.0.0',

  build(input: ResumeSummaryPromptInput): string {
    return [
      'You are summarizing the output of a resumed code-worker session.',
      'Analyze the transcript below and extract a brief summary of what was accomplished.',
      'Return ONLY a JSON object with a single field, no markdown fences.',
      '',
      'Rules:',
      '- Find the summary the worker stated directly in the last assistant messages.',
      '- If no explicit summary exists, write 2-4 concise bullet points (markdown *) describing what was accomplished.',
      '- Keep it concise and factual.',
      '',
      'Field:',
      '- summary: concise bullet-point summary (markdown *, max 4 points) of what the worker accomplished in this resumed session',
      '',
      'Example valid response:',
      '{"summary":"* Fixed the authentication bug by updating the token refresh logic\\n* CI passed after the fix"}',
      '',
      'Transcript (last 20 lines):',
      input.transcript,
    ].join('\n');
  },
};
