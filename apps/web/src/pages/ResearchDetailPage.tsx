import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle, Copy } from 'lucide-react';
import {
  Card,
  Layout,
  MarkdownContent,
} from '@/components';
import { useResearch, useResearchDetailActions } from '@/hooks';
import { ResearchHeader } from '@/components/research/ResearchHeader.js';
import { ResearchActions } from '@/components/research/ResearchActions.js';
import { ResearchResults } from '@/components/research/ResearchResults.js';
import { ProcessingStatus, CollapsibleInputContext } from '@/components/research/ProcessingStatus.js';
import { EnhanceModal } from '@/components/research/EnhanceModal.js';
import { isProcessingStatus } from '@/components/research/shared.js';

export function ResearchDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { research, loading, error, refresh } = useResearch(id ?? '');
  const navigate = useNavigate();

  const actions = useResearchDetailActions(id, research, refresh, navigate);

  useEffect(() => {
    if (research !== null && research.status === 'draft') {
      void navigate(`/research/new?draftId=${research.id}`, { replace: true });
    }
  }, [research, navigate]);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (research !== null && research.status === 'draft') {
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
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error ?? 'Research not found'}
        </div>
      </Layout>
    );
  }

  const isProcessing = isProcessingStatus(research.status);
  const showLlmStatus =
    isProcessing || research.status === 'failed' || research.status === 'awaiting_confirmation';

  return (
    <Layout>
      <ResearchHeader
        research={research}
        togglingFavourite={actions.togglingFavourite}
        favouriteError={actions.favouriteError}
        onToggleFavourite={actions.onToggleFavourite}
        copiedSection={actions.copiedSection}
        onCopyToClipboard={actions.copyToClipboard}
      />

      <ResearchActions
        research={research}
        approve={actions.approve}
        retry={actions.retry}
        deleteAction={actions.deleteAction}
        unshare={actions.unshare}
        exportToNotion={actions.exportToNotion}
        onShowEnhanceModal={actions.onShowEnhanceModal}
        onShare={actions.onShare}
        onEditDraft={(): void => { void navigate(`/research/new?draftId=${research.id}`); }}
        partialFailure={actions.partialFailure}
      />

      <Card className="mb-6 mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {research.originalPrompt !== undefined ? 'Enhanced Topic' : 'Research Topic'}
          </h3>
          <button
            type="button"
            onClick={() => {
              actions.copyToClipboard(research.prompt, 'research-topic');
            }}
            className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
            title={actions.copiedSection === 'research-topic' ? 'Copied!' : 'Copy'}
          >
            {actions.copiedSection === 'research-topic' ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
        <blockquote className="rounded border-l-4 border-blue-400 bg-slate-50 py-3 pl-4 pr-3 dark:bg-slate-700">
          <div className="text-slate-700 dark:text-slate-200">
            <MarkdownContent content={research.prompt} />
          </div>
        </blockquote>
        {research.originalPrompt !== undefined ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
              Show original topic
            </summary>
            <blockquote className="mt-2 rounded border-l-4 border-slate-300 bg-slate-100 py-2 pl-4 pr-3 text-sm italic text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400">
              <p className="whitespace-pre-wrap">{research.originalPrompt}</p>
            </blockquote>
          </details>
        ) : null}
      </Card>

      <ResearchResults
        research={research}
        copiedSection={actions.copiedSection}
        onCopy={actions.copyToClipboard}
      />

      {showLlmStatus ? (
        <ProcessingStatus
          llmResults={research.llmResults}
          selectedModels={research.selectedModels}
          synthesisModel={research.synthesisModel}
          researchStatus={research.status}
          hasInputContexts={
            research.inputContexts !== undefined && research.inputContexts.length > 0
          }
          title={research.status === 'failed' ? 'LLM Status' : 'Processing Status'}
        />
      ) : null}

      {isProcessing && research.inputContexts !== undefined && research.inputContexts.length > 0 ? (
        <Card title="Input Contexts" className="mb-6">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {String(research.inputContexts.length)} context
            {research.inputContexts.length > 1 ? 's' : ''} will be included in synthesis
          </p>
          <div className="space-y-3">
            {research.inputContexts.map((ctx, idx) => (
              <CollapsibleInputContext key={ctx.id} ctx={ctx} index={idx} />
            ))}
          </div>
        </Card>
      ) : null}

      {actions.showEnhanceModal ? (
        <EnhanceModal
          research={research}
          configuredProviders={actions.configuredProviders}
          failedProviders={actions.failedProviders}
          onEnhance={actions.handleEnhance}
          onClose={actions.onCloseEnhanceModal}
        />
      ) : null}

      {actions.shareToast !== null ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {actions.shareToast}
        </div>
      ) : null}
    </Layout>
  );
}
