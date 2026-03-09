/**
 * Prompt section for issue comment triage.
 *
 * Provides decision criteria for the GitHub Agent when triaging
 * issue_comment events (created or edited by bots).
 */

export interface IssueCommentTriagePromptInput {
  commentBody: string;
  isEdit: boolean;
  isBotSender: boolean;
  senderLogin: string;
}

export function buildIssueCommentTriageSection(input: IssueCommentTriagePromptInput): string {
  return [
    '## Comment Triage Instructions',
    '',
    `Comment by: @${input.senderLogin}${input.isBotSender ? ' (bot)' : ''}`,
    `Action: ${input.isEdit ? 'edited' : 'created'}`,
    '',
    '### Comment Body',
    '',
    input.commentBody !== '' ? input.commentBody : '(empty comment)',
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
  ].join('\n');
}
