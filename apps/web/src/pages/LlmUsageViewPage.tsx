/**
 * LLM Usage detail page — renders a single usage event with card sections.
 */

import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, Layout } from '@/components';
import { useLlmUsageEvent } from '@/hooks/useLlmUsageEvent';
import { formatDateTime, formatDurationMs } from '@/utils/dateFormat';
import type { UsageEvent } from '@/types/llmUsage';

// --- Formatting helpers ---

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatNullableCost(usd: number | null): string {
  if (usd === null) return '-';
  return formatCost(usd);
}

// --- Detail row component ---

interface DetailRowProps {
  label: string;
  value: string | number | boolean | null | undefined;
}

function DetailRow({ label, value }: DetailRowProps): React.JSX.Element | null {
  if (value === undefined) return null;
  let displayValue: string;
  if (value === null) {
    displayValue = '-';
  } else if (typeof value === 'boolean') {
    displayValue = value ? 'Yes' : 'No';
  } else {
    displayValue = String(value);
  }

  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{displayValue}</span>
    </div>
  );
}

// --- Section cards ---

function EventHeader({ event }: { event: UsageEvent }): React.JSX.Element {
  return (
    <div className="mb-4">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Usage Event</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        <span className="font-mono">{event.eventId}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600 dark:text-slate-300">{formatDateTime(event.occurredAt)}</span>
        <span className="text-slate-400 dark:text-slate-500">|</span>
        <span className="font-medium text-slate-900 dark:text-slate-100">{event.request.provider}</span>
        <span className="text-slate-400 dark:text-slate-500">/</span>
        <span className="text-slate-700 dark:text-slate-300">{event.request.model}</span>
        <span className="text-slate-400 dark:text-slate-500">|</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          event.request.success
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        }`}>
          {event.request.success ? 'Success' : 'Failed'}
        </span>
      </div>
    </div>
  );
}

function RequestCard({ request }: { request: UsageEvent['request'] }): React.JSX.Element {
  return (
    <Card title="Request" className="mb-4">
      <DetailRow label="Provider" value={request.provider} />
      <DetailRow label="Model" value={request.model} />
      <DetailRow label="Operation" value={request.operation} />
      <DetailRow label="Success" value={request.success} />
      <DetailRow label="Duration" value={formatDurationMs(request.durationMs)} />
      <DetailRow label="Prompt Type" value={request.promptType} />
    </Card>
  );
}

function UsageCard({ usage }: { usage: UsageEvent['usage'] }): React.JSX.Element {
  return (
    <Card title="Token Usage" className="mb-4">
      <DetailRow label="Input Tokens" value={formatTokens(usage.inputTokens)} />
      <DetailRow label="Output Tokens" value={formatTokens(usage.outputTokens)} />
      <DetailRow label="Total Tokens" value={formatTokens(usage.totalTokens)} />
      <DetailRow label="Cache Read Tokens" value={formatTokens(usage.cacheReadTokens)} />
      <DetailRow label="Cache Write Tokens" value={formatTokens(usage.cacheWriteTokens)} />
      <DetailRow label="Cached Tokens" value={formatTokens(usage.cachedTokens)} />
      <DetailRow label="Reasoning Tokens" value={formatTokens(usage.reasoningTokens)} />
      <DetailRow label="Thinking Tokens" value={formatTokens(usage.thinkingTokens)} />
      <DetailRow label="Web Search Calls" value={usage.webSearchCalls} />
      <DetailRow label="Grounding" value={usage.groundingEnabled} />
      <DetailRow label="Images" value={usage.imageCount} />
    </Card>
  );
}

function CostCard({ cost }: { cost: UsageEvent['cost'] }): React.JSX.Element {
  return (
    <Card title="Cost" className="mb-4">
      <DetailRow label="Billed USD" value={formatCost(cost.billedUsd)} />
      <DetailRow label="Provider Reported USD" value={formatNullableCost(cost.providerReportedUsd)} />
      <DetailRow label="Calculated USD" value={formatNullableCost(cost.calculatedUsd)} />
      <DetailRow label="Pricing Source" value={cost.pricingSource} />
    </Card>
  );
}

function SourceCard({ source, owner }: { source: UsageEvent['source']; owner: UsageEvent['owner'] }): React.JSX.Element {
  return (
    <Card title="Source" className="mb-4">
      <DetailRow label="Service" value={source.service} />
      <DetailRow label="Component" value={source.component} />
      <DetailRow label="Client" value={source.client} />
      <DetailRow label="Environment" value={source.environment} />
      <DetailRow label="Worker Location" value={source.workerLocation} />
      <DetailRow label="Owner Type" value={owner.type} />
      <DetailRow label="Owner ID" value={owner.id} />
    </Card>
  );
}

function CorrelationCard({ correlation }: { correlation: UsageEvent['correlation'] }): React.JSX.Element {
  return (
    <Card title="Correlation" className="mb-4">
      <DetailRow label="Request ID" value={correlation.requestId} />
      <DetailRow label="Trace ID" value={correlation.traceId} />
      <DetailRow label="Task ID" value={correlation.taskId} />
      <DetailRow label="Research ID" value={correlation.researchId} />
      <DetailRow label="Attempt" value={correlation.attempt} />
      <DetailRow label="Session ID" value={correlation.sessionId} />
    </Card>
  );
}

function ErrorCard({ error }: { error: NonNullable<UsageEvent['error']> }): React.JSX.Element {
  return (
    <Card title="Error" variant="error" className="mb-4">
      <DetailRow label="Code" value={error.code} />
      <DetailRow label="Message" value={error.message} />
    </Card>
  );
}

function RawJsonCard({ event }: { event: UsageEvent }): React.JSX.Element {
  return (
    <Card className="mb-4">
      <details>
        <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200">
          Raw JSON
        </summary>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {JSON.stringify(event, null, 2)}
        </pre>
      </details>
    </Card>
  );
}

// --- Main Page ---

export function LlmUsageViewPage(): React.JSX.Element {
  const { eventId } = useParams<{ eventId: string }>();
  const { event, loading, error } = useLlmUsageEvent(eventId ?? '');

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </Layout>
    );
  }

  if (error !== null || event === null) {
    return (
      <Layout>
        <Card variant="error" className="mt-4">
          <p>{error ?? 'Event not found'}</p>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <Link
        to="/llm-usage"
        className="mb-4 inline-flex items-center text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        &larr; Back to Events
      </Link>

      <EventHeader event={event} />
      <RequestCard request={event.request} />
      <UsageCard usage={event.usage} />
      <CostCard cost={event.cost} />
      <SourceCard source={event.source} owner={event.owner} />
      <CorrelationCard correlation={event.correlation} />
      {event.error !== null ? <ErrorCard error={event.error} /> : null}
      <RawJsonCard event={event} />
    </Layout>
  );
}
