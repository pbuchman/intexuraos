/**
 * Pure rendering functions for PR automation log events.
 *
 * Converts typed AutomationEvent values into Markdown lines
 * suitable for appending to a single GitHub PR comment.
 */

import type { AutomationEvent } from '../ports/automationLog.js';

export interface RenderEventOptions {
  repository?: string;
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
  const ts = formatTimestamp();

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
      return `**${ts}** -- Task dispatched: [\`${event.taskId}\`](https://intexuraos.cloud/#/code-tasks/${event.taskId}) | ${event.workerType}`;

    case 'task_dispatch_failed':
      return renderTaskDispatchFailed(ts, event);

    case 'linear_issue_failed':
      return `**${ts}** -- ⚠️ Linear issue creation failed | ${event.error}`;

    case 'task_started':
      return `**${ts}** -- Task started | attempt ${String(event.attempt)}`;

    case 'task_completed':
      return renderTaskCompleted(ts, event, options);

    case 'task_failed':
      return renderTaskFailed(ts, event);

    case 'task_interrupted':
      return renderTaskInterrupted(ts, event);

    case 'review_replaced':
      return `**${ts}** -- Review cancelled (replaced) | ${event.replacedTaskId}`;
  }
}

// ---------------------------------------------------------------------------
// Internal renderers
// ---------------------------------------------------------------------------

function renderWebhookReceived(
  ts: string,
  event: Extract<AutomationEvent, { type: 'webhook_received' }>
): string {
  const eventLabel = `\`${event.eventType}.${event.action}\``;
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
    details.push(`Cost: ${formatCost(event.cost)}`);
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
    ? `**${ts}** -- Triage -> **Dispatching review** (\`${reviewTypes.join(', ')}\`)`
    : `**${ts}** -- Triage -> **Dispatching task**`;

  const details: string[] = [];
  details.push(`Cost: ${formatCost(event.cost)}`);
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
  const parts: string[] = [`**${ts}** -- **Completed**`, formatDuration(event.duration)];

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

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTimestamp(): string {
  const now = new Date();
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires fallback despite split always returning non-empty array @preserve */
  return parts[parts.length - 1] ?? '?';
  /* v8 ignore stop @preserve */
}

function wrapDetails(label: string, content: string): string {
  return `<details><summary>${label}</summary>\n\n${content}\n</details>`;
}
