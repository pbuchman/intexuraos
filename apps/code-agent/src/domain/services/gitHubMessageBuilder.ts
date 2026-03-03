import type { GitHubPREvent } from '../models/gitHubPREvent.js';

export interface MessageTemplate {
  render(event: GitHubPREvent): string;
}

export interface WebhookMessageBuilder {
  build(event: GitHubPREvent): string;
}

function extractId(payload: unknown, key: string): string {
  if (typeof payload !== 'object' || payload === null || !(key in payload)) return 'unknown';
  const obj = (payload as Record<string, unknown>)[key];
  if (typeof obj !== 'object' || obj === null || !('id' in obj)) return 'unknown';
  const id = (obj as Record<string, unknown>)['id'];
  return typeof id === 'string' || typeof id === 'number' ? String(id) : 'unknown';
}

function extractReviewState(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('review' in payload)) return 'unknown';
  const review = (payload as Record<string, unknown>)['review'];
  if (typeof review !== 'object' || review === null || !('state' in review)) return 'unknown';
  const state = (review as Record<string, unknown>)['state'];
  return typeof state === 'string' ? state : 'unknown';
}

export class PullRequestReviewTemplate implements MessageTemplate {
  render(event: GitHubPREvent): string {
    const { repository, pullRequestNumber, senderLogin, body, payload } = event;
    const prNumber = String(pullRequestNumber);
    const reviewId = extractId(payload, 'review');
    const reviewState = extractReviewState(payload);

    return `[PR Review] New review on PR #${prNumber} in ${repository}
From: @${senderLogin}
Review ID: ${reviewId}
Review state: ${reviewState}

Review body:
${body ?? '(empty)'}

Instructions:
1. Check PR state: gh pr view ${prNumber} --json state,merged
2. Fetch inline comments for this review: gh api /repos/${repository}/pulls/${prNumber}/reviews/${reviewId}/comments
3. React with rocket to each inline comment: gh api /repos/\${repository}/pulls/comments/{id}/reactions -f content=rocket
4. Read all comments and understand the full context
5. For questions: investigate codebase, reply with answer
6. For fix requests: make changes, commit, reply with reasoning
7. Reply to each comment: gh api /repos/\${repository}/pulls/\${prNumber}/comments -f body="..." -F in_reply_to={id}
8. If review body exists, react with rocket and reply to the review as well`;
  }
}

export class EditedBotReviewTemplate implements MessageTemplate {
  render(event: GitHubPREvent): string {
    const { repository, pullRequestNumber, senderLogin, body, payload } = event;
    const prNumber = String(pullRequestNumber);
    const commentId = extractId(payload, 'comment');

    return `[PR Comment — Bot Review Edit] Comment updated on PR #${prNumber} in ${repository}
From: @${senderLogin}
Comment ID: ${commentId}
Type: issue_comment (edited)

Full comment body:
${body ?? '(empty)'}

Instructions:
1. CHECK IF REVIEW IS STILL IN PROGRESS:
   Look for indicators that the review is NOT finished:
   - Body contains "is working" / "working..." / spinner image
   - Body is very short (< 200 chars) with no findings
   - Checklist items are unchecked ([ ] without [x])

   If the review appears to still be in progress → do nothing, stop here.

2. IF REVIEW IS FINALIZED — process it as a code review:
   a. React with rocket: gh api /repos/${repository}/issues/comments/${commentId}/reactions -f content=rocket
   b. Read the full review body and extract EVERY finding/issue/suggestion
   c. For EACH finding, decide: FIX or SKIP
      - FIX: Clear actionable feedback, code change with clear intent, specific bug or gap
      - SKIP: Discussion/question, intentional design disagreement, out of PR scope, pure status report
   d. Post a response comment with a triage table:
      - One row per finding
      - Columns: # | Finding | Verdict (FIX/SKIP) | Reasoning | Action
      - For SKIP items: explain why in the Reasoning column
      - For FIX items: write "Will fix" in the Action column

   ⚠ MANDATORY — DO NOT STOP AFTER POSTING THE TABLE ⚠
   e. IMMEDIATELY after posting the triage comment, implement ALL fixes
      marked as FIX in the table. This is not optional. Do not end your turn
      until every FIX item has been implemented, committed, and pushed.
      Skipping implementation after posting the table is a contract violation.
   f. After all fixes: commit, push, verify CI passes
   g. Update your triage comment (gh api PATCH /repos/${repository}/issues/comments/{your-comment-id})
      to replace "Will fix" with the actual commit SHA for each implemented fix`;
  }
}

export class IssueCommentTemplate implements MessageTemplate {
  render(event: GitHubPREvent): string {
    const { repository, pullRequestNumber, senderLogin, body, payload } = event;
    const prNumber = String(pullRequestNumber);
    const commentId = extractId(payload, 'comment');

    return `[PR Comment] New comment on PR #${prNumber} in ${repository}
From: @${senderLogin}
Comment ID: ${commentId}
Type: issue_comment

The commenter said:
${body ?? '(empty)'}

Instructions:
1. React with rocket to the comment: gh api /repos/${repository}/issues/comments/${commentId}/reactions -f content=rocket
2. Read the comment and decide if it needs a response
3. If actionable: investigate, then reply via gh api /repos/${repository}/issues/${prNumber}/comments -f body="..."
4. If not actionable (e.g. coverage report, "+1", bot noise): do nothing`;
  }
}

export function createWebhookMessageBuilder(allowedBots: Set<string>): WebhookMessageBuilder {
  const reviewTemplate = new PullRequestReviewTemplate();
  const commentTemplate = new IssueCommentTemplate();
  const editedBotTemplate = new EditedBotReviewTemplate();

  return {
    build(event: GitHubPREvent): string {
      if (event.action === 'edited' && allowedBots.has(event.senderLogin)) {
        return editedBotTemplate.render(event);
      }
      if (event.eventType === 'pull_request_review') {
        return reviewTemplate.render(event);
      }
      return commentTemplate.render(event);
    },
  };
}
