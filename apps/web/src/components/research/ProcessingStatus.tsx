import { useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { Card, MarkdownContent } from '@/components';
import { formatRelative } from '@/utils/dateFormat';
import type { InputContext, LlmResult, ResearchStatus, SupportedModel } from '@/services/researchAgentApi.types';
import { getModelDisplayName } from './shared.js';

type DotStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

const DOT_COLORS: Record<DotStatus, string> = {
  pending: 'bg-slate-300',
  processing: 'bg-blue-500 animate-pulse',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  skipped: 'bg-slate-200',
};

export function StatusDot({ status }: { status: DotStatus }): React.JSX.Element {
  return <div className={`h-3 w-3 rounded-full ${DOT_COLORS[status]}`} />;
}

export function ErrorDisplay({
  error,
  className,
}: {
  error: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
    </div>
  );
}

interface CollapsibleInputContextProps {
  ctx: InputContext;
  index: number;
  showFull?: boolean;
}

export function CollapsibleInputContext({
  ctx,
  index,
  showFull = false,
}: CollapsibleInputContextProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const title =
    ctx.label !== undefined && ctx.label !== '' ? ctx.label : `Context ${String(index + 1)}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700">
      <button
        type="button"
        onClick={(): void => {
          setExpanded(!expanded);
        }}
        className="flex w-full cursor-pointer items-center justify-between p-3 hover:bg-slate-100 transition-colors dark:hover:bg-slate-600"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</span>
          <span className="text-xs text-slate-400">
            {ctx.content.length.toLocaleString()} chars
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded ? (
        <div className="border-t border-slate-200 p-4 dark:border-slate-600">
          {showFull ? (
            <MarkdownContent content={ctx.content} />
          ) : (
            <p className="break-words text-sm text-slate-600 whitespace-pre-wrap dark:text-slate-300">{ctx.content}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface ProcessingStatusProps {
  llmResults: LlmResult[];
  selectedModels: SupportedModel[];
  synthesisModel: SupportedModel;
  researchStatus: ResearchStatus;
  hasInputContexts: boolean;
  title?: string;
}

export function ProcessingStatus({
  llmResults,
  selectedModels,
  synthesisModel,
  researchStatus,
  hasInputContexts,
  title = 'Processing Status',
}: ProcessingStatusProps): React.JSX.Element {
  const willSynthesize = selectedModels.length > 1 || hasInputContexts;
  const getStatusText = (result: LlmResult): string => {
    if (result.status === 'completed' && result.durationMs !== undefined) {
      return `(${(result.durationMs / 1000).toFixed(1)}s)`;
    }
    if (result.status === 'processing') {
      if (result.startedAt !== undefined) {
        return `Started ${formatRelative(result.startedAt)}, processing...`;
      }
      return 'Processing...';
    }
    if (result.status === 'pending') {
      return 'Waiting...';
    }
    return '';
  };

  const getSynthesisStatus = (): { status: DotStatus; text: string } => {
    if (researchStatus === 'synthesizing') {
      return { status: 'processing', text: 'Synthesizing...' };
    }
    if (researchStatus === 'completed') {
      return { status: 'completed', text: 'Complete' };
    }
    if (researchStatus === 'failed') {
      const allLlmsFailed = llmResults.every((r) => r.status === 'failed');
      if (allLlmsFailed) {
        return { status: 'skipped', text: 'Skipped (all LLMs failed)' };
      }
      return { status: 'failed', text: 'Failed' };
    }
    return { status: 'pending', text: 'Pending' };
  };

  const synthesisStatus = getSynthesisStatus();

  return (
    <Card title={title} className="mb-6">
      <div className="space-y-3">
        {selectedModels.map((model) => {
          const result = llmResults.find((r) => r.model === model);
          const modelName = getModelDisplayName(model);

          if (result === undefined) {
            return (
              <div key={model} className="flex items-center gap-3">
                <StatusDot status="pending" />
                <span className="dark:text-slate-200">{modelName}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">Waiting...</span>
              </div>
            );
          }

          return (
            <div key={model} className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <StatusDot status={result.status} />
                <span className="dark:text-slate-200">{modelName}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">{getStatusText(result)}</span>
              </div>
              {result.status === 'failed' && result.error !== undefined && result.error !== '' ? (
                <ErrorDisplay error={result.error} className="ml-6" />
              ) : null}
            </div>
          );
        })}

        {willSynthesize ? (
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <StatusDot status={synthesisStatus.status} />
              <span className="font-medium dark:text-slate-200">Synthesis</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                ({getModelDisplayName(synthesisModel)})
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">{synthesisStatus.text}</span>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
