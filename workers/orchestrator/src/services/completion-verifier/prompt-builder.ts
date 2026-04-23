import type { CompletionAgentType } from './schemas.js';

function sharedPreamble(): string[] {
  return [
    'IMPORTANT RULES:',
    '- Analyze the transcript from the END toward the beginning. The most recent output takes priority — e.g. pnpm run ci:tracked may have failed and then succeeded; the expected result is the final outcome.',
    '- The LLM agent delivers its summary in one of the last assistant messages.',
    '- superpowers_writing_plans: "used" only if the agent explicitly claims it invoked the writing-plans superpowers skill.',
    '- Linear URL format example (DO NOT copy this URL; extract the real one from the transcript): https://linear.app/example-org/issue/EXAMPLE-1/example-issue-slug',
    '- GitHub PR URL format example (DO NOT copy this URL; extract the real one from the transcript): https://github.com/example-org/example-repo/pull/999',
    '',
  ];
}

export function buildPlanningPrompt(transcript: string): string {
  return [
    'You are a task-completion verifier for the Planning Agent.',
    'Analyze the transcript below and extract the following fields as JSON.',
    'Return ONLY a JSON object, no markdown fences.',
    '',
    ...sharedPreamble(),
    'Fields:',
    '- outcome: "planned" if the agent produced a plan, "unclear" if the agent could not plan',
    '- superpowers_writing_plans: "used" if the agent invoked the writing-plans skill, "not used" otherwise',
    '- linear_url: the Linear issue URL — the single issue the agent received as input and edited in-place (string, empty string if not found)',
    '- is_complex: "1" if the agent created subtasks for parallel execution, "0" otherwise',
    '- has_plan_doc: "1" if the agent created a plan document in docs/plans/, "0" otherwise',
    '- subtask_urls: comma-separated Linear issue URLs for all subtasks created (string, empty string if none)',
    '- pr_url: the GitHub Pull Request URL — REQUIRED for "planned" outcome (ALL planned tasks must produce a PR, including simple ones). Empty string ONLY for "unclear" outcome.',
    '- memory_ids_used: comma-separated injected memory IDs the agent reported using (string, empty string if none)',
    '- memory_ids_rejected: comma-separated injected memory IDs the agent reported rejecting (string, empty string if none)',
    '- memory_usage_summary: one-sentence summary of how injected memories influenced the plan, or empty string if none were injected',
    '- summary: concise bullet-point summary (markdown *, max 5-6 points) of what happened — the LLM agent typically states this clearly as a summary block in its final output',
    '- unclear_clarification: required when outcome is "unclear" — the message explaining why; empty string if outcome is "planned"',
    '',
    'Example valid response (placeholder URLs — do NOT copy these; extract real ones from the transcript):',
    '{"outcome":"planned","superpowers_writing_plans":"used","linear_url":"https://linear.app/example-org/issue/EXAMPLE-1/example-issue-slug","is_complex":"1","has_plan_doc":"1","subtask_urls":"https://linear.app/example-org/issue/EXAMPLE-2/example-subtask-a,https://linear.app/example-org/issue/EXAMPLE-3/example-subtask-b","pr_url":"https://github.com/example-org/example-repo/pull/999","memory_ids_used":"mem_142","memory_ids_rejected":"mem_188","memory_usage_summary":"Used the planning memory to keep the implementation split aligned with prior architecture.","summary":"* Analyzed task requirements\\n* Decided on a complex implementation requiring parallel subtasks\\n* Created 5 child issues covering API endpoints, database schema, and test strategy\\n* Produced a plan PR with the full implementation design","unclear_clarification":""}',
    '',
    'Transcript (last 50 lines):',
    transcript,
  ].join('\n');
}

export function buildExecutionPrompt(transcript: string): string {
  return [
    'You are a task-completion verifier for the Execution Agent.',
    'Analyze the transcript below and extract the following fields as JSON.',
    'Return ONLY a JSON object, no markdown fences.',
    '',
    ...sharedPreamble(),
    'Fields:',
    '- outcome: "implemented" if the agent created a PR with new code, "already_completed" if the agent determined the work was already done/merged, "failed" if the transcript clearly shows the agent could not complete the task',
    '- superpowers_subagent_driven_dev: "used" if the agent invoked the subagent-driven-development skill, "not used" otherwise',
    '- superpowers_requesting_code_review: "used" if the agent invoked the requesting-code-review skill, "not used" otherwise',
    '- gh_pr_url: the GitHub Pull Request URL — REQUIRED for all successful execution outcomes (both implemented and already_completed). Must not be empty for successful outcomes. When `outcome` is `"failed"`, `gh_pr_url` may be empty.',
    '- failure_reason: short structured reason when `outcome` is `"failed"` (e.g. `"rate_limited"`, `"non_zero_exit"`, `"missing_final_block"`). Empty string otherwise.',
    '- memory_ids_used: comma-separated memory IDs the agent reported using (string, empty string if none)',
    '- memory_ids_rejected: comma-separated memory IDs the agent reported rejecting as stale or not applicable (string, empty string if none)',
    '- memory_usage_summary: one-sentence summary of how the memories helped or why they were rejected (string, empty string if not found)',
    '- summary: concise bullet-point summary (markdown *, max 5-6 points) of what was implemented — the LLM agent typically states this clearly as a summary block in its final output',
    '',
    'Use `"failed"` when the transcript clearly shows the agent could not complete the task (e.g. interrupted by rate limit, aborted, exited mid-work). When `outcome` is `"failed"`, `gh_pr_url` may be empty.',
    '',
    'Example valid responses (placeholder URLs — do NOT copy these; extract real ones from the transcript):',
    '{"outcome":"implemented","superpowers_subagent_driven_dev":"used","superpowers_requesting_code_review":"used","gh_pr_url":"https://github.com/example-org/example-repo/pull/999","failure_reason":"","memory_ids_used":"mem_142,mem_155","memory_ids_rejected":"mem_188","memory_usage_summary":"Used the route logging and coverage memories to keep the callback fix aligned with existing verification patterns.","summary":"* Implemented the feature with 3 new API endpoints and updated database schema\\n* CI passed on the first attempt\\n* Created PR targeting the development branch"}',
    '{"outcome":"already_completed","superpowers_subagent_driven_dev":"used","superpowers_requesting_code_review":"not used","gh_pr_url":"https://github.com/example-org/example-repo/pull/998","failure_reason":"","memory_ids_used":"","memory_ids_rejected":"mem_188","memory_usage_summary":"Rejected the supplied memory because the codebase already matched the current repo state.","summary":"* Discovered the requested work was already implemented and merged into development\\n* Verified all tests pass and the feature is present in the codebase\\n* Created evidence PR documenting completion"}',
    '{"outcome":"failed","superpowers_subagent_driven_dev":"not used","superpowers_requesting_code_review":"not used","gh_pr_url":"","failure_reason":"rate_limited","memory_ids_used":"","memory_ids_rejected":"","memory_usage_summary":"","summary":"* Task was interrupted due to a rate limit before completion\\n* Worker exited non-zero without producing a final result block"}',
    '',
    'Transcript (last 50 lines):',
    transcript,
  ].join('\n');
}

export function buildPullRequestPrompt(transcript: string): string {
  return [
    'You are a task-completion verifier for the Pull Request Agent.',
    'Analyze the transcript below and extract the following fields as JSON.',
    'Return ONLY a JSON object, no markdown fences.',
    '',
    ...sharedPreamble(),
    'Fields:',
    '- gh_pr_url: the GitHub Pull Request URL (string, empty string if not found)',
    '- comments_replied: "yes" if the agent replied to PR comments, "no" otherwise',
    '- tracking_comment_id: the numeric GitHub comment ID from the tracking comment POST response (string, must not be empty)',
    '- memory_ids_used: comma-separated injected memory IDs the agent reported using (string, empty string if none)',
    '- memory_ids_rejected: comma-separated injected memory IDs the agent reported rejecting (string, empty string if none)',
    '- memory_usage_summary: one-sentence summary of how injected memories influenced the PR work, or empty string if none were injected',
    '- summary: concise bullet-point summary (markdown *, max 5-6 points) of what was done — the LLM agent typically states this clearly as a summary block in its final output',
    '',
    'Example valid response (placeholder URL — do NOT copy this; extract the real one from the transcript):',
    '{"gh_pr_url":"https://github.com/example-org/example-repo/pull/999","comments_replied":"yes","tracking_comment_id":"2345678","memory_ids_used":"mem_142","memory_ids_rejected":"","memory_usage_summary":"Used the injected PR memory to keep the replies aligned with existing workflow expectations.","summary":"* Addressed 3 review comments on the PR\\n* Pushed code changes and CI passed\\n* All reviewer feedback resolved"}',
    '',
    'Transcript (last 50 lines):',
    transcript,
  ].join('\n');
}

export function buildReviewPrompt(transcript: string): string {
  return [
    'You are a task-completion verifier for the Review Agent.',
    'Analyze the transcript below and extract the following fields as JSON.',
    'Return ONLY a JSON object, no markdown fences.',
    '',
    ...sharedPreamble(),
    'Fields:',
    '- gh_pr_url: the GitHub Pull Request URL (string, empty string if not found)',
    '- review_id: numeric review identifier returned by the single POST /reviews API call (string, omit when not found)',
    '- review_comments_posted: number of review comments posted as a string (e.g., "3")',
    '- review_types: comma-separated list of review types performed (e.g., "code_quality,security")',
    '- memory_ids_used: comma-separated injected memory IDs the agent reported using (string, empty string if none)',
    '- memory_ids_rejected: comma-separated injected memory IDs the agent reported rejecting (string, empty string if none)',
    '- memory_usage_summary: one-sentence summary of how injected memories influenced the review, or empty string if none were injected',
    '- requirements_tracker_updated: "yes" if tracker comment was created/updated, "no" if skipped, empty string if no requirements available',
    '- gh_actions_status: GitHub Actions check result (e.g., "all passed", "2 failed", "pending", "not yet triggered")',
    '- needs_remediation: "0" if the PR is clean or all findings are informational only, "1" if any finding requires code changes. Operational/manual verification steps (deploying migrations, running commands in environments, manual testing in dev/prod) are post-merge activities and do NOT count as code remediation',
    '- summary: concise bullet-point summary (markdown *, max 5-6 points) of the review findings — the LLM agent typically states this clearly as a summary block in its final output',
    '',
    'Example valid response (placeholder URL — do NOT copy this; extract the real one from the transcript):',
    '{"gh_pr_url":"https://github.com/example-org/example-repo/pull/999","review_id":"321654987","review_comments_posted":"3","review_types":"code_quality,security","memory_ids_used":"mem_142","memory_ids_rejected":"mem_188","memory_usage_summary":"Used the injected review memory to validate the architecture findings against prior incidents.","requirements_tracker_updated":"yes","gh_actions_status":"all passed","needs_remediation":"1","summary":"* Reviewed the PR for code quality and security issues\\n* Found 3 issues: missing null check, unused import, and potential XSS vulnerability\\n* All findings posted as inline review comments"}',
    '',
    'The review_id must be the numeric GitHub review ID created by the single POST /reviews call, not a comment ID. If the transcript does not contain it, omit review_id instead of inventing or blanking it.',
    '',
    'Transcript (last 50 lines):',
    transcript,
  ].join('\n');
}

export function buildRemediationPrompt(transcript: string): string {
  return [
    'You are a task-completion verifier for the Remediation Agent.',
    'Analyze the transcript below and extract the following fields as JSON.',
    'Return ONLY a JSON object, no markdown fences.',
    '',
    ...sharedPreamble(),
    'Fields:',
    '- outcome: "implemented" if the agent pushed remediation changes, "already_completed" if it determined the findings were already addressed',
    '- gh_pr_url: the GitHub Pull Request URL — REQUIRED for "implemented" outcome. Empty string ONLY for "already_completed" outcome.',
    '- memory_ids_used: comma-separated injected memory IDs the agent reported using (string, empty string if none)',
    '- memory_ids_rejected: comma-separated injected memory IDs the agent reported rejecting (string, empty string if none)',
    '- memory_usage_summary: one-sentence summary of how injected memories influenced the remediation, or empty string if none were injected',
    '- requires_re_review: "1" if the agent decided the PR must be re-reviewed after the changes, "0" otherwise',
    '- summary: concise bullet-point summary (markdown *, max 5-6 points) of the remediation work — the LLM agent typically states this clearly as a summary block in its final output',
    '',
    'Example valid responses (placeholder URLs — do NOT copy these; extract real ones from the transcript):',
    '{"outcome":"implemented","gh_pr_url":"https://github.com/example-org/example-repo/pull/999","memory_ids_used":"mem_142","memory_ids_rejected":"mem_188","memory_usage_summary":"Used the remediation memory to keep the fix scoped to the reviewed invariant.","requires_re_review":"1","summary":"* Addressed review findings on the existing PR branch and updated affected tests\\n* Pushed fixes to the PR\\n* Marked for re-review due to changes in reviewed areas"}',
    '{"outcome":"already_completed","gh_pr_url":"https://github.com/example-org/example-repo/pull/999","memory_ids_used":"","memory_ids_rejected":"mem_188","memory_usage_summary":"Rejected the supplied remediation memory because the fix was already present on the branch.","requires_re_review":"0","summary":"* Verified reported findings were already resolved on the PR branch\\n* No new code changes or push required"}',
    '',
    'Transcript (last 50 lines):',
    transcript,
  ].join('\n');
}

export function buildResumeSummaryPrompt(transcript: string): string {
  return [
    'You are summarizing the output of a resumed code-worker session.',
    'Analyze the transcript below and extract a brief summary of what was accomplished.',
    'Return ONLY a JSON object with a single field, no markdown fences.',
    '',
    'Rules:',
    '- Find the summary the worker stated directly in the last assistant messages.',
    '- If no explicit summary exists, write 2-4 concise bullet points (markdown *) describing what was accomplished.',
    '- Keep it concise and factual.',
    '',
    'Field:',
    '- summary: concise bullet-point summary (markdown *, max 4 points) of what the worker accomplished in this resumed session',
    '',
    'Example valid response:',
    '{"summary":"* Fixed the authentication bug by updating the token refresh logic\\n* CI passed after the fix"}',
    '',
    'Transcript (last 20 lines):',
    transcript,
  ].join('\n');
}

export function buildVerificationPrompt(
  agentType: CompletionAgentType,
  transcript: string
): string {
  if (agentType === 'planning') {
    return buildPlanningPrompt(transcript);
  }
  if (agentType === 'execution') {
    return buildExecutionPrompt(transcript);
  }
  if (agentType === 'review') {
    return buildReviewPrompt(transcript);
  }
  if (agentType === 'remediation') {
    return buildRemediationPrompt(transcript);
  }
  return buildPullRequestPrompt(transcript);
}
