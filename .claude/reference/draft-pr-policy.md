# Draft PR Policy

## Rule

When a pull request is in **draft** state, **no automated code-tasks are allowed**:

- No reviews
- No remediations (nitpick-nuker)
- No CI failure fixes
- No merge conflict fixes

When the PR transitions from draft to **ready for review**, the system immediately triggers an LLM-triaged review.

## How It Works

1. GitHub sends a `draft: true/false` boolean in the `pull_request` object of webhook payloads.
2. The `DraftPRRule` (in `apps/code-agent/src/domain/services/gitHubWebhookRules.ts`) checks `event.isDraft` and returns `skip` for draft PRs.
3. The rule is positioned early in the hard rules chain (after `CodeWorkerOutputRule`, before `CIFailureRule`), so draft PRs are blocked before any LLM triage cost.
4. The `ActionableEventRule` treats `ready_for_review` as `needs_triage`, which triggers LLM evaluation and review dispatch.

## Fail-Open Behavior

For event types where GitHub doesn't include draft status (e.g., `issue_comment`, `check_suite`), `isDraft` is `null` and the rule passes through. The primary vectors — `pull_request`, `pull_request_review`, and `pull_request_review_comment` events — all include draft status.

## Usage for Long-Lived PRs

To prevent automated interference on a long-lived PR (e.g., Hetzner migration):
1. Convert the PR to draft via GitHub UI
2. Work on the branch freely — no automated tasks will fire
3. When ready for review, mark the PR as ready — review will trigger automatically

## Related

- INT-1345: Original issue
- INT-750: Hetzner migration PR that motivated this policy
- `apps/code-agent/src/domain/services/gitHubWebhookRules.ts`: Rule implementation
