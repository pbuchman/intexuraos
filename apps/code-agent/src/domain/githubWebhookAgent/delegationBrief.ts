export interface DelegationBriefInput {
  repository: string;
  prNumber: number;
  senderLogin: string;
  comment: string;
  eventType: string;
  action: string;
}

export function buildWebhookDelegationBrief(input: DelegationBriefInput): string {
  const { repository, prNumber, senderLogin, comment, eventType } = input;

  const isReview = eventType === 'pull_request_review';

  const lines = [
    `[Delegated Task] PR #${String(prNumber)} in ${repository}`,
    `From: @${senderLogin}`,
    isReview ? 'Type: PR review' : 'Type: PR comment',
    '',
    isReview ? 'Review body:' : 'Comment:',
    comment,
    '',
    'Execution instructions:',
    `1. Check PR state: gh pr view ${String(prNumber)} --json state,merged,base,title,body`,
    `2. Read the full PR diff: gh pr diff ${String(prNumber)}`,
    `3. Read all PR comments: gh pr view ${String(prNumber)} --json comments`,
    '4. Understand the full context of the PR and the comment',
    '5. If changes are needed: investigate the codebase, implement the requested changes',
    '6. Run pnpm run ci:tracked — must pass before pushing',
    '7. Commit and push your changes to the existing PR branch',
  ];

  return lines.join('\n');
}
