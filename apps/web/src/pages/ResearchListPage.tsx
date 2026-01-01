import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Layout } from '@/components';
import { useResearches } from '@/hooks';
import type { Research, ResearchStatus } from '@/services/llmOrchestratorApi.types';

/**
 * Strip markdown formatting from text for clean display.
 * Handles bold, italic, headers, code markers, and surrounding quotes.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, '') // Remove bold markers
    .replace(/__/g, '') // Remove bold (underscore)
    .replace(/(?<!\*)\*(?!\*)/g, '') // Remove italic markers (single asterisk)
    .replace(/(?<!_)_(?!_)/g, '') // Remove italic (single underscore)
    .replace(/^#+\s*/gm, '') // Remove headers
    .replace(/`/g, '') // Remove code markers
    .replace(/^["']|["']$/g, '') // Remove surrounding quotes
    .trim();
}

interface StatusStyle {
  bg: string;
  text: string;
  label: string;
}

const STATUS_STYLES: Record<ResearchStatus, StatusStyle> = {
  draft: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Draft' },
  pending: { bg: 'bg-slate-100', text: 'text-slate-800', label: 'Pending' },
  processing: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Processing' },
  completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Completed' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
};

export function ResearchListPage(): React.JSX.Element {
  const { researches, loading, error, hasMore, loadMore, deleteResearch } = useResearches();

  if (loading && researches.length === 0) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Previous Researches</h2>
          <p className="text-slate-600">View and manage your research history</p>
        </div>
        <Link to="/research/new">
          <Button>New Research</Button>
        </Link>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {researches.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="mb-4 text-slate-600">No researches yet</p>
            <Link to="/research/new" className="text-blue-600 underline">
              Start your first research
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {researches.map((research) => (
            <ResearchCard
              key={research.id}
              research={research}
              onDelete={(): void => {
                void deleteResearch(research.id);
              }}
            />
          ))}

          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                onClick={(): void => {
                  void loadMore();
                }}
              >
                Load More
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Layout>
  );
}

interface ResearchCardProps {
  research: Research;
  onDelete: () => void;
}

function ResearchCard({ research, onDelete }: ResearchCardProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const status = STATUS_STYLES[research.status];
  const isDraft = research.status === 'draft';
  const deleteLabel = isDraft ? 'Discard' : 'Delete';

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between">
        <Link to={`/research/${research.id}`} className="flex-1">
          <h3 className="text-lg font-semibold text-slate-900 hover:text-blue-600">
            {research.title !== '' ? stripMarkdown(research.title) : 'Untitled Research'}
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{research.prompt}</p>
        </Link>
        <span
          className={`ml-4 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${status.bg} ${status.text}`}
        >
          {status.label}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <div className="flex gap-4">
          <span>Started: {formatDate(research.startedAt)}</span>
          {research.completedAt !== undefined ? (
            <span>Completed: {formatDate(research.completedAt)}</span>
          ) : null}
        </div>
        <div className="flex gap-2">
          {research.selectedLlms.map((llm) => (
            <span key={llm} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
              {llm}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        {showDeleteConfirm ? (
          <div className="flex gap-2">
            <Button variant="danger" onClick={onDelete}>
              Confirm {deleteLabel}
            </Button>
            <Button
              variant="secondary"
              onClick={(): void => {
                setShowDeleteConfirm(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            onClick={(): void => {
              setShowDeleteConfirm(true);
            }}
            className="text-sm text-slate-400 hover:text-red-600"
          >
            {deleteLabel}
          </button>
        )}
      </div>
    </div>
  );
}
