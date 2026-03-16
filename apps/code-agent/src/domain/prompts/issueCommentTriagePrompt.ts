/**
 * Prompt section for issue comment triage.
 *
 * Provides decision criteria for the GitHub Agent when triaging
 * issue_comment events (created or edited by bots).
 */

import { isReviewCommandComment, SUPPORTED_REVIEW_WORKER_TYPES } from '../utils/reviewTriage.js';

export interface IssueCommentTriagePromptInput {
  commentBody: string;
  isEdit: boolean;
  isBotSender: boolean;
  senderLogin: string;
}

export function buildIssueCommentTriageSection(input: IssueCommentTriagePromptInput): string {
  const isReviewCommand = isReviewCommandComment(input.commentBody);

  if (isReviewCommand) {
    return [
      '## Comment Triage Instructions',
      '',
      `Comment by: @${input.senderLogin}${input.isBotSender ? ' (bot)' : ''}`,
      `Action: ${input.isEdit ? 'edited' : 'created'}`,
      '',
      '### Comment Body',
      '',
      input.commentBody,
      '',
      '### Review Command Instructions',
      '',
      'The comment starts with `@review`, so this is a review-triage request.',
      'Do NOT use `dispatch_to_task` for this comment. Either request a review or skip.',
      '',
      'Allowed review types:',
      '- `code_quality`',
      '- `security`',
      '- `architecture`',
      '',
      `Allowed worker types: ${SUPPORTED_REVIEW_WORKER_TYPES.join(', ')}`,
      '- Use `qwen` for Qwen review requests.',
      '- Choose exactly one worker type and include it on every `request_review` tool call.',
      '- If the comment does not name a review scope, infer the best scope from the request. Default to `code_quality` when the request is generic.',
      '- If the comment requests architecture review and does not name a worker, prefer `qwen`.',
      '- If the comment requests security review and does not name a worker, prefer `opus`.',
      '',
      'Examples:',
      '- `@review architecture, security with qwen` → request `architecture` + `security`, worker `qwen`',
      '- `@review with minimax` → request `code_quality`, worker `minimax`',
      '- `@review opus` → request `code_quality`, worker `opus`',
      '- `@review architecture` → request `architecture`, worker `qwen`',
      '',
      'Always call exactly one tool type: either one-or-more `request_review` calls, or `skip`.',
      '',
      'After you finish all `request_review` tool calls or the `skip` tool call, return one short final sentence and stop.',
    ].join('\n');
  }

  return [
    '## Comment Triage Instructions',
    '',
    `Comment by: @${input.senderLogin}${input.isBotSender ? ' (bot)' : ''}`,
    `Action: ${input.isEdit ? 'edited' : 'created'}`,
    '',
    '### Comment Body',
    '',
    /* v8 ignore start -- schema: template conditional for empty comment body @preserve */
    input.commentBody !== '' ? input.commentBody : '(empty comment)',
    /* v8 ignore stop @preserve */
    '',
    '### Decision Criteria',
    '',
    "DISPATCH as 'pr_comment' when:",
    '- User is asking a question about the code',
    '- User is requesting a change',
    '- User is providing feedback that needs action',
    '',
    "DISPATCH as 'bot_review_edit' when:",
    '- Bot review is FINALIZED (all checklist items checked, no spinner, has findings)',
    '',
    'SKIP when:',
    '- Bot review is still in progress (spinner, unchecked items, "working...")',
    '- Comment is bot noise ("+1", thumbs up, "LGTM", coverage report)',
    '- Comment is a status update with no action needed',
    '- Comment is a duplicate of already-processed content',
    '',
    'Always call exactly one tool: either `dispatch_to_task` or `skip`.',
    '',
    'After you finish your tool call, return one short final sentence and stop.',
  ].join('\n');
}
