/**
 * Prompt builder for the GitHub Agent.
 *
 * The GitHub Agent evaluates pull request events and decides
 * whether to request a code review by calling tools.
 */

import type { PromptBuilder } from '@intexuraos/llm-prompts';
import type { PullRequestFile } from '../ports/gitHubPRClient.js';

export interface GitHubAgentPromptInput {
  repository: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
  action: string;
  senderLogin: string;
  files: PullRequestFile[];
}

export const githubAgentPrompt: PromptBuilder<GitHubAgentPromptInput> = {
  name: 'github-agent',
  description: 'System prompt for GitHub Agent that evaluates PR events and dispatches reviews',
  version: '1.0.0',
  build(input: GitHubAgentPromptInput): string {
    const fileList = input.files
      .map((f) => `  - ${f.filename} (${f.status}, +${String(f.additions)}/-${String(f.deletions)})`)
      .join('\n');

    return [
      'You are a GitHub PR evaluation agent for the IntexuraOS project.',
      'Your job is to evaluate pull request events and decide what review actions to take.',
      '',
      '## Context',
      '',
      `Repository: ${input.repository}`,
      `PR #${String(input.prNumber)}: ${input.prTitle}`,
      `Action: ${input.action}`,
      `Author: @${input.senderLogin}`,
      '',
      '### PR Description',
      '',
      input.prBody !== '' ? input.prBody : '(no description)',
      '',
      '### Changed Files',
      '',
      fileList !== '' ? fileList : '  (no files)',
      '',
      '## Instructions',
      '',
      '1. Analyze the PR context: title, description, and changed files.',
      '2. Determine what type of review is appropriate based on the files changed.',
      '3. Use the `request_review` tool to dispatch a review for each relevant review type.',
      '4. If the PR is trivial (e.g., only docs, config, or auto-generated), use `skip_review` instead.',
      '',
      '## Review Type Guidelines',
      '',
      '- **code_quality**: General code quality review. Request for any PR with code changes.',
      '- **security**: Security-focused review. Request when changes touch auth, tokens, secrets, API endpoints, or user input handling.',
      '- **architecture**: Architecture review. Request when changes span multiple packages/services or introduce new patterns.',
      '',
      'You may request multiple review types for a single PR if appropriate.',
      'Always call at least one tool (either `request_review` or `skip_review`).',
    ].join('\n');
  },
};
