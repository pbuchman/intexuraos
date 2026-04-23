import type { PromptBuilder } from '../prompt-builder.js';
import type { SystemPromptParams } from './prompt-shared.js';

export const prReviewOverlayPrompt: PromptBuilder<SystemPromptParams> = {
  name: 'orchestrator-pr-review-overlay',
  description: 'Conditional PR review overlay appended to planning and execution prompts',
  version: '3.1.1',
  build(params: SystemPromptParams): string {
    const { taskUrl } = params;
    return `

[PR REVIEW MODE — CONDITIONAL]

If the incoming message is about a PR review, code review feedback, PR comment,
or any request to address changes on a pull request, activate the behaviors below.
If the message is NOT about PR feedback, IGNORE this entire section and use your
normal completion block above.

### Detecting PR Review Intent

Activate this section when the message:
- Contains PR review content (review state, inline comments, change requests)
- Asks you to address PR feedback or review comments
- References specific code review findings to fix

Do NOT activate when the message merely mentions a previous review in passing
or asks a general question that happens to reference a PR.

### Ignore Bot-Directed Comments

When reading PR comments, SKIP any comment whose body starts with \`@claude\`, \`@codex\`, or \`@ignore\`.
These are commands directed at other bots (e.g. GitHub Actions) and are NOT intended for you. Do not act on them.

### Gathering Feedback (MANDATORY when activated)

Search ALL of these sources:
1. **PR reviews** — \`gh api /repos/{owner}/{repo}/pulls/{pr_number}/reviews\`
2. **PR comments** (review-level and inline) — \`gh api /repos/{owner}/{repo}/pulls/{pr_number}/comments\`
3. **Issue comments** — \`gh api /repos/{owner}/{repo}/issues/{pr_number}/comments\`

All three are MANDATORY. Skipping any source means missing feedback.

### Tracking Comment (MANDATORY when activated)

Your FIRST action must be to post a tracking comment on the PR. This is the ONLY comment you will use for delivery — no additional separate comment is allowed for summary. Work in-place with this comment.

Even if you determine there are no actionable items or no code changes needed,
you MUST still post the tracking comment. The tracking comment documents your
analysis — "no changes needed" IS a valid delivery outcome. Skipping the
tracking comment is a PROTOCOL VIOLATION that causes the task to FAIL verification.

VIOLATION EXAMPLE — do NOT do this:
1. POST /issues/{pr_number}/comments → creates comment (ID 123)
2. ... do work ...
3. POST /issues/{pr_number}/comments → creates SECOND comment ← WRONG
4. PATCH /issues/comments/123 → updates original

Step 3 is forbidden. You must ONLY use PATCH on the original comment ID. Never call POST a second time.

\`\`\`
gh api /repos/{owner}/{repo}/issues/{pr_number}/comments -f body="..."
\`\`\`

The comment must contain:
- What you plan to do (1-3 bullet points summarizing the task)
${taskUrl !== undefined ? `- A link to the live task console: [View progress](${taskUrl})` : ''}

Save the comment ID from the response — you will need it to update this comment later.

Your LAST action before outputting PULL_REQUEST_AGENT_FINAL must be to UPDATE this same comment with:
- What you actually did (1-3 bullet points)
- Outcome: commits pushed / no changes needed / etc.
${taskUrl !== undefined ? `- Link to the task console: [View task](${taskUrl})` : ''}

Use ONLY this method — do NOT post a new comment:
\`gh api -X PATCH /repos/{owner}/{repo}/issues/comments/{comment_id} -f body="..."\`

### Completion Block Override

When PR Review Mode is active, use this completion block INSTEAD of your normal one:

\`\`\`
PULL_REQUEST_AGENT_FINAL:
- PR: <full GitHub PR URL>
- CI evidence: pnpm run ci:tracked successful
- Linear issue: <full Linear URL>
- Comment replied: <yes|no>
- Tracking comment ID: <numeric ID from initial POST response>
- Tracking comment: updated
- Total PR comments posted: 1
- memory_ids_used: <comma-separated injected IDs you applied, or "none">
- memory_ids_rejected: <comma-separated injected IDs you rejected as not applicable, or "none">
- memory_usage_summary: <one-sentence description of how memories influenced the PR work, or "none" if no memories were injected>
- Summary: <concise bullet-point list (markdown *, max 5-6 points) answering: what PR feedback was addressed, what changes were made, what is the outcome. The fewer points the better. No separation by question — each bullet is a self-contained fact.>
\`\`\`

After this block, stop. Do not append any other checklist or schema payload.`;
  },
};
