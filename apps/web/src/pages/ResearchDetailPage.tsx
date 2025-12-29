import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Layout, Button, Card } from '@/components';
import { useResearch } from '@/hooks';
import type { LlmResult, ResearchStatus } from '@/services/llmOrchestratorApi.types';

interface StatusConfig {
  color: string;
  label: string;
}

const STATUS_CONFIG: Record<ResearchStatus, StatusConfig> = {
  pending: { color: 'text-slate-600', label: 'Waiting to start...' },
  processing: { color: 'text-blue-600', label: 'Processing...' },
  completed: { color: 'text-green-600', label: 'Completed' },
  failed: { color: 'text-red-600', label: 'Failed' },
};

export function ResearchDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { research, loading, error } = useResearch(id ?? '');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyToClipboard = async (text: string, section: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => {
      setCopiedSection(null);
    }, 2000);
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error !== null || research === null) {
    return (
      <Layout>
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error ?? 'Research not found'}
        </div>
        <Link to="/research" className="text-blue-600 underline">
          Back to list
        </Link>
      </Layout>
    );
  }

  const status = STATUS_CONFIG[research.status];
  const isProcessing = research.status === 'pending' || research.status === 'processing';
  const showLlmStatus = isProcessing || research.status === 'failed';

  const getDisplayTitle = (): string => {
    if (research.title !== '') {
      return research.title;
    }
    if (research.status === 'failed') {
      return 'Research Failed';
    }
    return 'Processing...';
  };

  return (
    <Layout>
      <div className="mb-4">
        <Link to="/research" className="text-sm text-blue-600 hover:underline">
          ← Back to list
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{getDisplayTitle()}</h2>
          <p className={`mt-1 text-sm ${status.color}`}>
            {status.label}
            {research.status === 'processing' ? (
              <span className="ml-2 inline-block animate-pulse">●</span>
            ) : null}
          </p>
        </div>
      </div>

      <Card title="Original Prompt" className="mb-6">
        <p className="text-slate-700">{research.prompt}</p>
      </Card>

      {showLlmStatus ? (
        <ProcessingStatus
          llmResults={research.llmResults}
          title={research.status === 'failed' ? 'LLM Status' : 'Processing Status'}
        />
      ) : null}

      {research.synthesizedResult !== undefined && research.synthesizedResult !== '' ? (
        <Card title="Synthesis Report" className="mb-6">
          <div className="mb-2 flex justify-end">
            <Button
              variant="secondary"
              onClick={(): void => {
                void copyToClipboard(research.synthesizedResult ?? '', 'synthesis');
              }}
            >
              {copiedSection === 'synthesis' ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <div className="prose max-w-none whitespace-pre-wrap rounded-lg bg-slate-50 p-4">
            {research.synthesizedResult}
          </div>
        </Card>
      ) : null}

      {research.synthesisError !== undefined && research.synthesisError !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <h3 className="font-medium text-red-800">Synthesis Failed</h3>
          <p className="mt-1 text-sm text-red-700">{research.synthesisError}</p>
        </div>
      ) : null}

      <div>
        <h3 className="mb-4 text-xl font-bold text-slate-900">Individual LLM Results</h3>
        <div className="space-y-4">
          {research.llmResults.map((result) => (
            <LlmResultCard
              key={result.provider}
              result={result}
              onCopy={(text): void => {
                void copyToClipboard(text, result.provider);
              }}
              copied={copiedSection === result.provider}
            />
          ))}
        </div>
      </div>
    </Layout>
  );
}

interface ProcessingStatusProps {
  llmResults: LlmResult[];
  title?: string;
}

function ProcessingStatus({
  llmResults,
  title = 'Processing Status',
}: ProcessingStatusProps): React.JSX.Element {
  return (
    <Card title={title} className="mb-6">
      <div className="space-y-3">
        {llmResults.map((result) => (
          <div key={result.provider} className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <StatusDot status={result.status} />
              <span className="capitalize">{result.provider}</span>
              <span className="text-sm text-slate-500">
                {result.status === 'completed' && result.durationMs !== undefined
                  ? `(${(result.durationMs / 1000).toFixed(1)}s)`
                  : ''}
              </span>
            </div>
            {result.status === 'failed' && result.error !== undefined && result.error !== '' ? (
              <p className="ml-6 text-sm text-red-600">{result.error}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatusDot({ status }: { status: string }): React.JSX.Element {
  const colors: Record<string, string> = {
    pending: 'bg-slate-300',
    processing: 'bg-blue-500 animate-pulse',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  };

  return <div className={`h-3 w-3 rounded-full ${colors[status] ?? 'bg-slate-300'}`} />;
}

interface LlmResultCardProps {
  result: LlmResult;
  onCopy: (text: string) => void;
  copied: boolean;
}

function LlmResultCard({ result, onCopy, copied }: LlmResultCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        onClick={(): void => {
          setExpanded(!expanded);
        }}
        className="flex w-full items-center justify-between p-4 hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <StatusDot status={result.status} />
          <span className="font-medium capitalize">{result.provider}</span>
          <span className="text-sm text-slate-500">{result.model}</span>
        </div>
        <span className="text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && result.result !== undefined && result.result !== '' ? (
        <div className="border-t border-slate-200 p-4">
          <div className="mb-2 flex justify-end">
            <Button
              variant="secondary"
              onClick={(): void => {
                onCopy(result.result ?? '');
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <div className="prose max-w-none whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm">
            {result.result}
          </div>
          {result.sources !== undefined && result.sources.length > 0 ? (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <h4 className="mb-2 text-sm font-medium">Sources</h4>
              <ul className="text-sm text-blue-600">
                {result.sources.map((source, i) => (
                  <li key={i}>
                    <a
                      href={source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {source}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {expanded && result.error !== undefined && result.error !== '' ? (
        <div className="border-t border-slate-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{result.error}</p>
        </div>
      ) : null}
    </div>
  );
}
