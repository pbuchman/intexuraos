import { describe, expect, it } from 'vitest';
import {
  buildExecutionPrompt,
  buildPlanningPrompt,
  buildPullRequestPrompt,
  buildRemediationPrompt,
  buildReviewPrompt,
  buildVerificationPrompt,
} from '../../../services/completion-verifier/prompt-builder.js';

describe('buildVerificationPrompt', () => {
  const transcript = 'sample transcript';

  it('dispatches to buildPlanningPrompt for planning', () => {
    expect(buildVerificationPrompt('planning', transcript)).toBe(buildPlanningPrompt(transcript));
  });

  it('dispatches to buildExecutionPrompt for execution', () => {
    expect(buildVerificationPrompt('execution', transcript)).toBe(buildExecutionPrompt(transcript));
  });

  it('dispatches to buildReviewPrompt for review', () => {
    expect(buildVerificationPrompt('review', transcript)).toBe(buildReviewPrompt(transcript));
  });

  it('dispatches to buildRemediationPrompt for remediation', () => {
    expect(buildVerificationPrompt('remediation', transcript)).toBe(
      buildRemediationPrompt(transcript)
    );
  });

  it('dispatches to buildPullRequestPrompt for pull_request', () => {
    expect(buildVerificationPrompt('pull_request', transcript)).toBe(
      buildPullRequestPrompt(transcript)
    );
  });

  it('dispatches to buildPullRequestPrompt for ask_agent (fallback)', () => {
    expect(buildVerificationPrompt('ask_agent', transcript)).toBe(
      buildPullRequestPrompt(transcript)
    );
  });

  it('includes the transcript at the end of the prompt', () => {
    const out = buildVerificationPrompt('execution', 'UNIQUE_TRANSCRIPT_MARKER');
    expect(out.endsWith('UNIQUE_TRANSCRIPT_MARKER')).toBe(true);
  });

  it('includes agent-specific phrasing per type', () => {
    expect(buildVerificationPrompt('planning', transcript)).toContain('Planning Agent');
    expect(buildVerificationPrompt('execution', transcript)).toContain('Execution Agent');
    expect(buildVerificationPrompt('review', transcript)).toContain('Review Agent');
    expect(buildVerificationPrompt('remediation', transcript)).toContain('Remediation Agent');
    expect(buildVerificationPrompt('pull_request', transcript)).toContain('Pull Request Agent');
  });
});
