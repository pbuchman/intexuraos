import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components';
import { PromptCard } from './research/PromptCard.js';
import { ResearchModelsCard } from './research/ResearchModelsCard.js';
import { SynthesisModelCard } from './research/SynthesisModelCard.js';
import { InputContextCard } from './research/InputContextCard.js';
import { ResearchActionBar } from './research/ResearchActionBar.js';
import { SingleProviderConfirmModal } from './research/SingleProviderConfirmModal.js';
import { DiscardDraftModal } from './research/DiscardDraftModal.js';
import { ImprovementSuggestionModal } from './research/ImprovementSuggestionModal.js';
import { ValidationModal } from './research/ValidationModal.js';
import { RESEARCH_AGENT_CONSTANTS, useResearchAgent } from './research/useResearchAgent.js';

export function ResearchAgentPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('draftId');
  const agent = useResearchAgent({ draftId });

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {agent.isEditMode ? 'Edit Research' : 'New Research'}
        </h2>
        <p className="text-slate-600 dark:text-slate-300">
          Run your research prompt across multiple LLMs and get a synthesized report.
        </p>
      </div>

      {agent.loading ? (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          Loading draft...
        </div>
      ) : null}

      {!agent.hasAnyProvider && !agent.keysLoading ? (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
          <p className="text-amber-800 dark:text-amber-300">
            <strong>No API keys configured.</strong> Configure at least one API key to start
            research.{' '}
            <a href="/#/settings/api-keys" className="underline">
              Configure API keys
            </a>
          </p>
        </div>
      ) : null}

      {agent.error !== null && agent.error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {agent.error}
        </div>
      ) : null}

      <div className="space-y-6">
        <PromptCard
          prompt={agent.prompt}
          onPromptChange={agent.setPrompt}
          onPromptBlur={agent.handlePromptBlur}
          onAutoImprove={(): void => {
            void agent.handleAutoImprove();
          }}
          improving={agent.improving}
          submitting={agent.submitting}
          savingDraft={agent.savingDraft}
        />

        <ResearchModelsCard
          modelSelections={agent.modelSelections}
          onModelChange={agent.handleModelChange}
          configuredProviders={agent.configuredProviders}
          failedProviders={agent.failedProviders}
          keysLoading={agent.keysLoading}
          submitting={agent.submitting}
          savingDraft={agent.savingDraft}
          openRouterModels={agent.openRouterModels}
          selectedOpenRouterModels={agent.selectedOpenRouterModels}
          onOpenRouterChange={agent.setSelectedOpenRouterModels}
          openRouterLoading={agent.openRouterLoading}
          openRouterError={agent.openRouterError}
          isOpenRouterConfigured={agent.isOpenRouterConfigured}
        />

        <SynthesisModelCard
          synthesisCapableModels={RESEARCH_AGENT_CONSTANTS.SYNTHESIS_CAPABLE_MODELS}
          synthesisModel={agent.synthesisModel}
          onSelect={agent.setSynthesisModel}
          configuredProviders={agent.configuredProviders}
          failedProviders={agent.failedProviders}
          keysLoading={agent.keysLoading}
          submitting={agent.submitting}
          savingDraft={agent.savingDraft}
        />

        <InputContextCard
          inputContexts={agent.inputContexts}
          maxInputContexts={RESEARCH_AGENT_CONSTANTS.MAX_INPUT_CONTEXTS}
          maxContextLength={RESEARCH_AGENT_CONSTANTS.MAX_CONTEXT_LENGTH}
          onAdd={agent.addInputContext}
          onRemove={agent.removeInputContext}
          onUpdate={agent.updateInputContext}
          submitting={agent.submitting}
          savingDraft={agent.savingDraft}
        />

        <ResearchActionBar
          isEditMode={agent.isEditMode}
          prompt={agent.prompt}
          canSubmit={agent.canSubmit}
          submitting={agent.submitting}
          savingDraft={agent.savingDraft}
          discarding={agent.discarding}
          validating={agent.validating}
          disabledReason={agent.getDisabledReason()}
          onDiscardClick={(): void => {
            agent.setShowDiscardConfirm(true);
          }}
          onSaveDraft={(): void => {
            void agent.handleSaveDraft();
          }}
          onSubmit={(): void => {
            void agent.handleSubmit();
          }}
        />
      </div>

      <SingleProviderConfirmModal
        open={agent.showSingleProviderConfirm}
        selectedModelId={agent.selectedModels[0]}
        submitting={agent.submitting}
        onCancel={(): void => {
          agent.setShowSingleProviderConfirm(false);
        }}
        onProceed={agent.handleConfirmProceed}
      />

      <DiscardDraftModal
        open={agent.showDiscardConfirm}
        discarding={agent.discarding}
        onCancel={(): void => {
          agent.setShowDiscardConfirm(false);
        }}
        onConfirm={(): void => {
          void agent.handleDiscardDraft();
        }}
      />

      <ImprovementSuggestionModal
        open={agent.showImprovementModal}
        originalPrompt={agent.prompt}
        improvedPrompt={agent.pendingImprovedPrompt}
        onUseOriginal={agent.handleUseOriginalPrompt}
        onUseImproved={agent.handleUseImprovedPrompt}
      />

      <ValidationModal
        open={agent.showValidationModal}
        validating={agent.validating}
        warning={agent.validationWarning}
        onDismiss={(): void => {
          agent.setShowValidationModal(false);
          agent.setValidationWarning(null);
        }}
      />
    </Layout>
  );
}
