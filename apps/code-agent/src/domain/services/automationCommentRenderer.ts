/**
 * Pure rendering functions for PR automation log events.
 *
 * Converts typed AutomationEvent values into Markdown lines
 * suitable for appending to a single GitHub PR comment.
 */

import type { AgentType } from '../models/codeTask.js';
import type { AutomationEvent } from '../ports/automationLog.js';

export interface RenderEventOptions {
  repository?: string;
  timezone?: string | undefined;   // IANA timezone, e.g. "Europe/Berlin"
  timestamp?: string | undefined;  // ISO 8601 datetime of the event
}

/**
 * Returns the fixed header block for the automation comment.
 */
export function renderHeader(): string {
  return '@ignore\n### IntexuraOS Automation\n';
}

/**
 * Renders a single automation event as one or more Markdown lines.
 *
 * Returns `null` for events that should be hidden from the log
 * (deterministic skips from webhook_route or hard_rules).
 */
export function renderEvent(
  event: AutomationEvent,
  options?: RenderEventOptions
): string | null {
  const ts = formatTimestamp(
    options?.timestamp ?? new Date().toISOString(),
    options?.timezone
  );

  switch (event.type) {
    case 'webhook_received':
      return renderWebhookReceived(ts, event);

    case 'skipped':
      return renderSkipped(ts, event);

    case 'triage_dispatch':
      return renderTriageDispatch(ts, event);

    case 'triage_failed':
      return renderTriageFailed(ts, event);

    case 'task_dispatched':
      return `**${ts}** -- ${agentTypeLabel(event.agentType)} dispatched | ${event.workerType} | [View task](https://intexuraos.cloud/#/code-tasks/${event.taskId})`;

    case 'task_dispatch_failed':
      return renderTaskDispatchFailed(ts, event);

    case 'linear_issue_failed':
      return `**${ts}** -- ⚠️ Linear issue creation failed | ${event.error}`;

    case 'task_started': {
      const label = event.agentType !== undefined
        ? agentTypeLabel(event.agentType)
        : 'Task';
      return event.attempt > 1
        ? `**${ts}** -- ${label} started | attempt ${String(event.attempt)}`
        : `**${ts}** -- ${label} started`;
    }

    case 'task_completed':
      return renderTaskCompleted(ts, event, options);

    case 'task_failed':
      return renderTaskFailed(ts, event);

    case 'task_interrupted':
      return renderTaskInterrupted(ts, event);

    case 'review_replaced':
      return `**${ts}** -- Review cancelled (replaced) | ${event.replacedTaskId}`;

    case 'remediation_decision':
      return renderRemediationDecision(ts, event);

    case 'ci_failure_detected':
      return `**${ts}** -- ⚠️ CI check failed: ${event.checkName} | branch: ${event.headBranch} | ${event.conclusion}`;

    case 'fix_task_dispatched':
      return `**${ts}** -- Fix task dispatched for CI failure | parent: \`${event.parentTaskId}\` → fix: \`${event.fixTaskId}\``;

    case 'ci_failure_skip':
      return `**${ts}** -- CI failure skip: ${event.reason}`;
  }
}

// ---------------------------------------------------------------------------
// Internal renderers
// ---------------------------------------------------------------------------

function webhookEventLabel(eventType: string, action: string): string {
  const key = `${eventType}.${action}`;
  switch (key) {
    case 'pull_request.opened': return 'PR opened';
    case 'pull_request.synchronize': return 'Commits pushed';
    case 'pull_request.closed': return 'PR closed';
    case 'pull_request.reopened': return 'PR reopened';
    case 'pull_request_review.submitted': return 'Review submitted';
    case 'pull_request_review_comment.created': return 'Inline comment';
    case 'issue_comment.created': return 'Comment posted';
    default: return `\`${key}\``;
  }
}

function renderWebhookReceived(
  ts: string,
  event: Extract<AutomationEvent, { type: 'webhook_received' }>
): string {
  const eventLabel = webhookEventLabel(event.eventType, event.action);
  const linkedLabel = event.eventUrl !== undefined
    ? `[${eventLabel}](${event.eventUrl})`
    : eventLabel;
  const base = `**${ts}** -- ${linkedLabel} by @${event.sender}`;
  if (event.summary !== undefined) {
    return `${base} — ${event.summary}`;
  }
  return base;
}

function renderSkipped(
  ts: string,
  event: Extract<AutomationEvent, { type: 'skipped' }>
): string | null {
  // Hide deterministic noise — webhook_route and hard_rules skips
  if (event.decidedBy === 'webhook_route' || event.decidedBy === 'hard_rules') {
    return null;
  }

  const summary = `**${ts}** -- **Skipped** | ${event.reason}`;
  const details: string[] = [];

  if (event.ruleName !== undefined) {
    details.push(`Rule: ${event.ruleName}`);
  }
  if (event.cost !== undefined) {
    details.push(`Triage cost: ${formatCost(event.cost)}`);
  }
  if (event.reasoning !== undefined) {
    details.push('', event.reasoning);
  }
  if (event.toolCalls !== undefined && event.toolCalls.length > 0) {
    details.push('', '**Tool calls:**', ...event.toolCalls.map((tc) => `- \`${tc}\``));
  }

  if (details.length === 0) {
    return summary;
  }
  return summary + '\n' + wrapDetails('Details', details.join('\n'));
}

function renderTriageDispatch(
  ts: string,
  event: Extract<AutomationEvent, { type: 'triage_dispatch' }>
): string {
  const reviewTypes = event.reviewTypes;
  const hasReviewTypes =
    reviewTypes !== undefined && reviewTypes.length > 0;
  const headline = hasReviewTypes
    ? `**${ts}** -- Triage → dispatching review (\`${reviewTypes.join(', ')}\`)`
    : `**${ts}** -- Triage → dispatching task`;

  const details: string[] = [];
  details.push(`Triage cost: ${formatCost(event.cost)}`);
  details.push('', event.reasoning);
  if (event.toolCalls.length > 0) {
    details.push('', '**Tool calls:**', ...event.toolCalls.map((tc) => `- \`${tc}\``));
  }

  return headline + '\n' + wrapDetails('Details', details.join('\n'));
}

function renderTriageFailed(
  ts: string,
  event: Extract<AutomationEvent, { type: 'triage_failed' }>
): string {
  const summary = `**${ts}** -- **Triage failed** | ${event.fallbackAction}`;
  const details = event.error;
  return summary + '\n' + wrapDetails('Error', details);
}

function renderTaskDispatchFailed(
  ts: string,
  event: Extract<AutomationEvent, { type: 'task_dispatch_failed' }>
): string {
  const summary = `**${ts}** -- **Dispatch failed**`;
  const details: string[] = [event.error];
  if (event.errorCode !== undefined) {
    details.push(`Code: ${event.errorCode}`);
  }
  return summary + '\n' + wrapDetails('Error', details.join('\n'));
}

function renderTaskCompleted(
  ts: string,
  event: Extract<AutomationEvent, { type: 'task_completed' }>,
  options?: RenderEventOptions
): string {
  const completionLabel = event.agentType !== undefined
    ? `${agentTypeLabel(event.agentType)} completed`
    : completedLabel(event.status);
  const parts: string[] = [`**${ts}** -- **${completionLabel}**`, formatDuration(event.duration)];

  if (event.prUrl !== undefined) {
    const prNumber = extractPrNumber(event.prUrl);
    parts.push(`[PR #${prNumber}](${event.prUrl})`);
  }

  const summary = parts.join(' | ');

  const commits = event.commits;
  const hasCommits = commits !== undefined && commits.length > 0;
  if (!hasCommits) {
    return summary;
  }

  const commitLines = commits.map((c) => {
    const shortSha = c.sha.slice(0, 7);
    if (options?.repository !== undefined) {
      return `- [\`${shortSha}\`](https://github.com/${options.repository}/commit/${c.sha}) ${c.message}`;
    }
    return `- \`${shortSha}\` ${c.message}`;
  });

  return summary + '\n' + wrapDetails('Commits', commitLines.join('\n'));
}

function renderTaskFailed(
  ts: string,
  event: Extract<AutomationEvent, { type: 'task_failed' }>
): string {
  const parts: string[] = [`**${ts}** -- **Failed**`];
  if (event.duration !== undefined) {
    parts.push(formatDuration(event.duration));
  }
  if (event.errorCode !== undefined) {
    parts.push(event.errorCode);
  }
  const summary = parts.join(' | ');
  const details: string[] = [event.error];
  return summary + '\n' + wrapDetails('Error', details.join('\n'));
}

function renderTaskInterrupted(
  ts: string,
  event: Extract<AutomationEvent, { type: 'task_interrupted' }>
): string {
  if (event.duration !== undefined) {
    return `**${ts}** -- **Interrupted** | ${formatDuration(event.duration)}`;
  }
  return `**${ts}** -- **Interrupted**`;
}

function renderRemediationDecision(
  ts: string,
  event: Extract<AutomationEvent, { type: 'remediation_decision' }>
): string | null {
  if (!event.required) {
    return `**${ts}** -- Remediation not required`;
  }

  if (event.taskId !== undefined) {
    // Suppressed: task_dispatched is always emitted before this event when taskId is set.
    // If task_dispatched is absent from the log, this entry will also be missing.
    return null;
  }

  if (event.signal === 'missing') {
    return `**${ts}** -- Remediation required (dispatch failed, review signal missing)`;
  }

  return `**${ts}** -- Remediation required (dispatch failed)`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

// timeZoneName: 'short' produces named abbreviations (CET, CEST) for European/UTC
// zones but GMT±N (e.g. "GMT-5") for most other regions — standard en-GB behavior.
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = fmtCache.get(tz);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
      timeZoneName: 'short',
    });
    fmtCache.set(tz, fmt);
  }
  return fmt;
}

function formatTimestamp(iso: string, timezone?: string): string {
  return getFormatter(timezone ?? 'UTC').format(new Date(iso));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours)}h ${String(minutes)}m`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds)}s`;
  }
  return `${String(seconds)}s`;
}

function formatCost(dollars: number): string {
  return `$${dollars.toFixed(3)}`;
}

function extractPrNumber(prUrl: string): string {
  const parts = prUrl.split('/');
  /* v8 ignore start -- ts-type: String.split always returns ≥1 element — cannot produce empty split result @preserve */
  return parts[parts.length - 1] ?? '?';
  /* v8 ignore stop @preserve */
}

function wrapDetails(label: string, content: string): string {
  return `<details><summary>${label}</summary>\n\n${content}\n</details>`;
}

function agentTypeLabel(agentType: AgentType): string {
  switch (agentType) {
    case 'review': return 'Review';
    case 'remediation': return 'Remediation';
    case 'execution': return 'Implementation';
    case 'planning': return 'Plan';
    case 'pull_request': return 'PR';
  }
}

function completedLabel(status: 'implemented' | 'reviewed' | 'planned' | 'unknown'): string {
  switch (status) {
    case 'reviewed': return 'Review completed';
    case 'implemented': return 'Implementation completed';
    case 'planned': return 'Plan completed';
    default: return 'Completed';
  }
}
