/**
 * Prompt builder for the GitHub Agent.
 *
 * Handles both pull_request and issue_comment event types.
 * For PRs: evaluates files and decides what reviews to request.
 * For comments: triages whether to dispatch or skip.
 */

import type { PromptBuilder } from '@intexuraos/llm-prompts';
import type { PullRequestFile } from '../ports/gitHubPRClient.js';
import { buildIssueCommentTriageSection } from './issueCommentTriagePrompt.js';

export interface GitHubAgentPromptInput {
  repository: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  action: string;
  senderLogin: string;
  eventType: 'pull_request' | 'issue_comment';
  // PR-specific fields
  files?: PullRequestFile[];
  // Comment-specific fields
  commentBody?: string;
  isEdit?: boolean;
  isBotSender?: boolean;
}

export const githubAgentPrompt: PromptBuilder<GitHubAgentPromptInput> = {
  name: 'github-agent',
  description: 'System prompt for GitHub Agent that evaluates PR and comment events',
  version: '5.2.0',
  build(input: GitHubAgentPromptInput): string {
    const sections: string[] = [
      'You are a GitHub webhook evaluation agent for the IntexuraOS project.',
      'Your job is to evaluate events and decide what action to take.',
      '',
      '## Context',
      '',
      `Repository: ${input.repository}`,
      `PR #${String(input.prNumber)}: ${input.prTitle}`,
      `Action: ${input.action}`,
      `Author: @${input.senderLogin}`,
    ];

    if (input.eventType === 'pull_request') {
      sections.push(...buildPRSection(input));
    } else {
      sections.push(...buildCommentSection(input));
    }

    return sections.join('\n');
  },
};

function buildPRSection(input: GitHubAgentPromptInput): string[] {
  /* v8 ignore start -- ts-type: null coalescing fallback for optional array @preserve */
  const files = input.files ?? [];
  /* v8 ignore stop @preserve */
  const fileList = files
    .map((f) => `  - ${f.filename} (${f.status}, +${String(f.additions)}/-${String(f.deletions)})`)
    .join('\n');

  return [
    '',
    '### PR Description',
    '',
    /* v8 ignore start -- schema: template conditional for empty PR body @preserve */
    input.prBody !== '' ? input.prBody : '(no description)',
    /* v8 ignore stop @preserve */
    '',
    '### Changed Files',
    '',
    /* v8 ignore start -- schema: template conditional for empty file list @preserve */
    fileList !== '' ? fileList : '  (no files)',
    /* v8 ignore stop @preserve */
    '',
    '## Instructions',
    '',
    '1. Analyze the PR context: title, description, and changed files.',
    '2. Determine what type of review is appropriate based on the files changed.',
    '3. Use the `request_review` tool to dispatch a review for each relevant review type.',
    '4. If the PR is trivial (e.g., only docs, config, or auto-generated), use `skip` instead.',
    '',
    '## Review Type Guidelines',
    '',
    '- **code_quality**: General code quality review. Request for any PR with code changes.',
    '- **security**: Security-focused review. Request when changes touch auth, tokens, secrets, API endpoints, or user input handling.',
    '- **architecture**: Architecture review. Request when changes span multiple packages/services or introduce new patterns.',
    '- **test_quality**: Request when PR has significant test file changes (.test.ts, .spec.ts). Checks for false positives, testing granularity, v8 ignore legitimacy, and test design.',
    '',
    'You may request multiple review types for a single PR if appropriate.',
    'Note: Plan-only PRs (all files match *plan*.md) are automatically routed to plan_review — you will never see them.',
    'Always call at least one tool (either `request_review` or `skip`).',
    '',
    '## HARD RULES',
    '',
    '- You must NEVER call the same tool with the same arguments more than once. Each tool call must be unique.',
    '- If you need `code_quality` review, call `request_review({"review_type":"code_quality"})` exactly ONCE.',
    '- Duplicate tool calls are a critical error. One call per review type, maximum.',
    '',
    '## Examples',
    '',
    'Example 1 — PR with code changes:',
    '1. Call `request_review({"review_type":"code_quality"})`',
    '2. Respond: "Requested code_quality review for this feature PR."',
    '',
    'Example 2 — PR touching auth + multiple packages:',
    '1. Call `request_review({"review_type":"code_quality"})`',
    '2. Call `request_review({"review_type":"security"})`',
    '3. Respond: "Requested code_quality and security reviews for auth changes."',
    '',
    'Example 3 — Docs-only PR:',
    '1. Call `skip({"reason":"Documentation-only change, no code to review."})`',
    '2. Respond: "Skipped — documentation-only change."',
    '',
    'Example 4 — PR with significant test file changes:',
    '1. Call `request_review({"review_type":"code_quality"})`',
    '2. Call `request_review({"review_type":"test_quality"})`',
    '3. Respond: "Requested code_quality and test_quality reviews for test-heavy PR."',
  ];
}

function buildCommentSection(input: GitHubAgentPromptInput): string[] {
  const triageSection = buildIssueCommentTriageSection({
    /* v8 ignore start -- ts-type: null coalescing for optional prompt inputs @preserve */
    commentBody: input.commentBody ?? '',
    isEdit: input.isEdit ?? false,
    isBotSender: input.isBotSender ?? false,
    /* v8 ignore stop @preserve */
    senderLogin: input.senderLogin,
  });

  return ['', triageSection];
}
