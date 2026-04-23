import { describe, expect, it } from 'vitest';
import {
  buildExecutionPrompt,
  buildPlanningPrompt,
  buildPullRequestPrompt,
  buildRemediationPrompt,
  buildResumeSummaryPrompt,
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

// ---------------------------------------------------------------------------
// Byte-pin regression guards.
// These tests lock the exact prompt size + anchor substrings for each builder
// so any intentional prompt edit must also update the assertions, forcing
// reviewer approval of user-facing prompt text changes.
// ---------------------------------------------------------------------------
describe('prompt byte-pins', () => {
  const T = 'TRANSCRIPT_MARKER';

  it('buildPlanningPrompt pins length and boundary anchors', () => {
    const p = buildPlanningPrompt(T);
    expect(p.length).toBe(3341);
    expect(p.startsWith('You are a task-completion verifier for the Planning Agent.')).toBe(true);
    expect(p.endsWith(`Transcript (last 50 lines):\n${T}`)).toBe(true);
    expect(p).toContain('- outcome: "planned" if the agent produced a plan');
    expect(p).toContain('- superpowers_writing_plans:');
    expect(p).toContain('- pr_url:');
  });

  it('buildExecutionPrompt pins length and boundary anchors', () => {
    const p = buildExecutionPrompt(T);
    expect(p.length).toBe(3257);
    expect(p.startsWith('You are a task-completion verifier for the Execution Agent.')).toBe(true);
    expect(p.endsWith(`Transcript (last 50 lines):\n${T}`)).toBe(true);
    expect(p).toContain('- gh_pr_url: the GitHub Pull Request URL');
    expect(p).toContain('- superpowers_subagent_driven_dev:');
    expect(p).toContain('- superpowers_requesting_code_review:');
  });

  it('buildPullRequestPrompt pins length and boundary anchors', () => {
    const p = buildPullRequestPrompt(T);
    expect(p.length).toBe(2296);
    expect(p.startsWith('You are a task-completion verifier for the Pull Request Agent.')).toBe(
      true
    );
    expect(p.endsWith(`Transcript (last 50 lines):\n${T}`)).toBe(true);
    expect(p).toContain('- tracking_comment_id:');
    expect(p).toContain('- comments_replied:');
  });

  it('buildReviewPrompt pins length and boundary anchors', () => {
    const p = buildReviewPrompt(T);
    expect(p.length).toBe(3372);
    expect(p.startsWith('You are a task-completion verifier for the Review Agent.')).toBe(true);
    expect(p.endsWith(`Transcript (last 50 lines):\n${T}`)).toBe(true);
    expect(p).toContain('- review_id:');
    expect(p).toContain('- needs_remediation:');
    expect(p).toContain('The review_id must be the numeric GitHub review ID');
  });

  it('buildRemediationPrompt pins length and boundary anchors', () => {
    const p = buildRemediationPrompt(T);
    expect(p.length).toBe(2857);
    expect(p.startsWith('You are a task-completion verifier for the Remediation Agent.')).toBe(
      true
    );
    expect(p.endsWith(`Transcript (last 50 lines):\n${T}`)).toBe(true);
    expect(p).toContain('- outcome: "implemented"');
    expect(p).toContain('- requires_re_review:');
  });

  it('buildResumeSummaryPrompt pins length and boundary anchors', () => {
    const p = buildResumeSummaryPrompt(T);
    expect(p.length).toBe(754);
    expect(p.startsWith('You are summarizing the output of a resumed code-worker session.')).toBe(
      true
    );
    expect(p.endsWith(`Transcript (last 20 lines):\n${T}`)).toBe(true);
    expect(p).toContain('- summary: concise bullet-point summary');
  });
});
