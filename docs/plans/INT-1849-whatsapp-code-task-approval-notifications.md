# INT-1849 WhatsApp Code Task Approval Notifications Implementation Plan

> **For the execution worker:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Goal

Make WhatsApp code-task notifications status-only for normal task lifecycle updates, and reserve important action-required WhatsApp messages for the moment a pull request is actually ready for user approval and deployment.

## Audit Findings

- `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` currently includes implementation details in successful-task WhatsApp messages: branch, commit count, and `result.summary`.
- Design-complete WhatsApp messages currently fall back to `result.summary`, so plan-ready notifications can include a change list instead of a status-only message.
- Successful execution completion and resumed completion notifications already use `important: true`, but they are sent when the task finishes, before the system knows whether the pull request is mergeable.
- Ready-to-merge state is currently represented by the `ready-to-merge` Linear label, set in `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts` and `apps/code-agent/src/domain/services/onReviewSkippedCallback.ts`.
- The Battlefield merge action is already visually purple through `IssueGroupRow`; the WhatsApp ready-to-merge message should match that state with a violet marker and approval/deployment copy rather than a green OK/check message.
- No repository code currently exposes a browser-presence or "task page currently open" signal. Treat "not currently open" as the existing non-active, ready-to-merge code-task state rather than adding a new presence system.

## Key Decisions

- Keep normal task-completion notifications as status-only messages and remove branch, commit, and summary/change-list content from WhatsApp bodies.
- Do not add a separate "view the pull request" notification if the existing ready-to-merge timing is sufficient. Rephrase the merge-ready notification to say that the task is waiting for user approval and deployment.
- Send the important merge-ready WhatsApp message only when the ready-to-merge state is newly reached and a fresh GitHub PR check confirms `mergeable === true`.
- Preserve existing ready-to-merge label behavior unless tests show it is tied directly to the WhatsApp send. The WhatsApp notification is the item that must be gated by GitHub mergeability.
- Avoid a new notification ledger for this change. Prevent duplicates by sending only when the code path newly applies the ready-to-merge label, and by skipping when the label was already present.

## Endpoint Changes

No HTTP route or API contract changes are expected.

Internal service contract changes are expected:

- Extend `apps/code-agent/src/domain/services/whatsappNotifier.ts` with a ready-to-merge notification method.
- Extend the notification dependency wiring for the ready-to-merge label paths if a shared helper is introduced.

## File Structure

Expected edits:

- `apps/code-agent/src/domain/services/whatsappNotifier.ts`
- `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts`
- `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`
- `apps/code-agent/src/domain/services/onReviewSkippedCallback.ts`
- `apps/code-agent/src/services.ts`
- `apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts`
- `apps/code-agent/src/__tests__/routes/webhooks.test.ts`
- `apps/code-agent/src/__tests__/domain/services/onReviewSkippedCallback.test.ts`

Optional new helper, only if it reduces duplication between completion and skipped-review paths:

- `apps/code-agent/src/domain/services/readyToMergeNotification.ts`
- Matching focused unit test under `apps/code-agent/src/__tests__/domain/services/`

## Implementation Tasks

### 1. Make lifecycle WhatsApp messages status-only

Write or update tests first in `whatsappNotifier.test.ts`:

- Standard successful task completion must not contain:
  - `Branch:`
  - `Commits:`
  - `result.summary`
  - bullet lists or changed-file details
- Resumed task completion must not contain `result.summary` or change-list content.
- Design-complete notification must say the plan is ready for implementation and must ignore `result.summary`.
- Existing CTA buttons should remain: implementation CTA for planning/design complete and PR CTA when a PR URL is present.

Then update `whatsappNotifierImpl.ts`:

- `formatCompletionMessage` should return a short status-only message such as:
  - `Task completed.`
  - If there is a PR CTA, the CTA button carries the PR navigation instead of the body describing changes.
- `formatResumedCompletionMessage` should state that the resumed task completed, without summary details.
- `formatDesignCompleteMessage` should use status copy like `Plan is ready for implementation.` and keep the implement prompt/button behavior.
- Ordinary task-complete and resumed-complete sends must be non-important. Remove their current `important: true` values and update existing tests that asserted completion notifications were important.
- Keep `important: true` only for states that require user action or already behave as action-required, such as the new merge-ready approval/deployment notification. Do not introduce important progress/start messages.

### 2. Add a dedicated ready-to-merge WhatsApp notification

Add a notifier method, for example:

```ts
notifyTaskReadyForMerge(
  userId: string,
  task: CodeTask,
  info: { prUrl: string; linearIssueId?: string }
): Promise<Result<void, NotificationError>>;
```

Implement it in `whatsappNotifierImpl.ts` with these semantics:

- `important: true`
- CTA button title: `View pull request`
- URL: the PR URL
- Body is status-only and contains no change list, branch name, commit count, or result summary.
- Use a violet/purple marker, not the green OK/check marker, for example:

```text
🟣 INT-1849 | Optimize WhatsApp notifications for code task approvals

Waiting for your approval and deployment.
```

Add notifier tests proving:

- The message uses the violet marker and approval/deployment copy.
- The message is important.
- The PR CTA is present.
- Summary/change-list details are absent even if the task result contains them.

### 3. Notify from the real ready-to-merge transition

Update `handleTaskCompletion.ts` around `applyReadyToMergeLabel`:

- Detect whether `ready-to-merge` was already present before applying labels.
- Apply existing validation and label-update behavior as today.
- After a successful label update, skip notification if:
  - the label was already present,
  - the label update was dropped,
  - the task is planning-origin,
  - no PR URL/number can be resolved,
  - no target user can be resolved,
  - GitHub PR details cannot be loaded,
  - the PR is not open, or
  - GitHub reports `mergeable !== true`.
- When all gates pass, call `notifyTaskReadyForMerge`.

Use existing GitHub helpers where possible. `loadPullRequestDetails` and `classifyMergeConflictStatus` in `mergeConflicts/detectConflicts.ts` already model the `mergeable` states; use those patterns rather than ad hoc polling.

Update `webhooks.test.ts` to cover:

- Fresh review-pass ready-to-merge label plus `mergeable: true` sends exactly one important ready-to-merge WhatsApp message.
- `mergeable: false` or `mergeable: null` does not send the WhatsApp ready message.
- Existing `ready-to-merge` label does not duplicate the WhatsApp message.
- Planning-origin tasks do not send the merge-ready WhatsApp message.
- Normal task-complete WhatsApp notification remains status-only and does not include the implementation summary.

### 4. Cover skipped-review ready-to-merge path

`onReviewSkippedCallback.ts` can also create the ready-to-merge state when automated review is skipped. Add the same notification gate there, preferably through a shared helper used by both this service and `handleTaskCompletion.ts`.

Add the dependency wiring required for that gate:

- Extend `OnReviewSkippedDeps` with the dependencies needed by the shared ready-to-merge notifier helper, including `gitHubPRClient`, `whatsappNotifier`, and a token/user resolver such as `resolveOAuthToken` or a narrower function that loads GitHub PR details for `origin.userId`.
- Use `origin.userId` as the notification target user and token owner for skipped-review PR checks.
- Update `apps/code-agent/src/services.ts` so `createOnReviewSkippedCallback` receives `gitHubPRClient`, `whatsappNotifier`, and token/user resolution wiring from the existing `userServiceClient`/`fetchGitHubToken` composition.
- Keep the callback best-effort: dependency, GitHub details, mergeability, and notification failures should log and skip the WhatsApp ready-to-merge send without preventing the existing label, automation log, and group summary work.

Update `onReviewSkippedCallback.test.ts` to cover:

- Execution-origin PR, newly applied label, open PR, and `mergeable: true` sends the ready-to-merge WhatsApp message.
- Planning-origin PRs still do not become merge-ready and do not notify.
- Existing `ready-to-merge` label does not duplicate the message.
- Non-mergeable or unknown-mergeability PRs do not notify.

### 5. Verification

Run focused tests while implementing:

```bash
pnpm --filter code-agent test -- apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts
pnpm --filter code-agent test -- apps/code-agent/src/__tests__/routes/webhooks.test.ts
pnpm --filter code-agent test -- apps/code-agent/src/__tests__/domain/services/onReviewSkippedCallback.test.ts
```

Then run tracked verification:

```bash
pnpm run verify:workspace:tracked -- code-agent
pnpm run ci:tracked
```

## Acceptance Criteria

- WhatsApp task-complete, resumed-complete, and design-complete messages no longer include code-task change lists, branch names, commit counts, or `result.summary` text.
- WhatsApp task-complete and resumed-complete sends are non-important; the merge-ready approval/deployment notification remains important.
- The plan-ready WhatsApp message states that the plan is ready for implementation.
- The merge-ready WhatsApp message says the PR is waiting for user approval and deployment.
- The merge-ready WhatsApp message is important and uses a violet/purple marker rather than a green OK/check marker.
- The merge-ready WhatsApp message is sent only when the ready-to-merge state is newly reached and a fresh GitHub PR check confirms the PR is open and `mergeable === true`.
- No duplicate ready-to-merge WhatsApp message is sent when the label already exists.
- Existing lifecycle notifications and CTAs continue to route users to the correct task or PR.
