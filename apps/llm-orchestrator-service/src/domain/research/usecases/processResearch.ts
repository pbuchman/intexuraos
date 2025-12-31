/**
 * Process research usecase.
 * Runs LLM calls in parallel, synthesizes results, sends notification.
 */

import type { LlmProvider } from '../models/index.js';
import type {
  ResearchRepository,
  LlmResearchProvider,
  LlmSynthesisProvider,
  TitleGenerator,
  NotificationSender,
} from '../ports/index.js';

export interface ProcessResearchDeps {
  researchRepo: ResearchRepository;
  llmProviders: Record<LlmProvider, LlmResearchProvider>;
  synthesizer: LlmSynthesisProvider;
  titleGenerator?: TitleGenerator;
  notificationSender: NotificationSender;
  reportLlmSuccess?: (provider: LlmProvider) => void;
}

interface LlmCallResult {
  provider: LlmProvider;
  model: string;
  content: string;
}

export async function processResearch(
  researchId: string,
  deps: ProcessResearchDeps
): Promise<void> {
  const researchResult = await deps.researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return;
  }

  const research = researchResult.value;

  // Update status to processing
  await deps.researchRepo.update(researchId, { status: 'processing' });

  // Generate title (use dedicated titleGenerator if available, else fall back to synthesizer)
  const titleGen = deps.titleGenerator ?? deps.synthesizer;
  const titleResult = await titleGen.generateTitle(research.prompt);
  if (titleResult.ok) {
    await deps.researchRepo.update(researchId, { title: titleResult.value });
    // Report success for title generator (Gemini if dedicated titleGenerator, else synthesis provider)
    if (deps.reportLlmSuccess !== undefined) {
      const titleProvider = deps.titleGenerator !== undefined ? 'google' : research.synthesisLlm;
      deps.reportLlmSuccess(titleProvider);
    }
  }

  // Run LLM calls in parallel
  const llmPromises = research.selectedLlms.map(
    async (provider: LlmProvider): Promise<LlmCallResult | null> => {
      const startedAt = new Date().toISOString();
      await deps.researchRepo.updateLlmResult(researchId, provider, {
        status: 'processing',
        startedAt,
      });

      const llmClient = deps.llmProviders[provider];
      const result = await llmClient.research(research.prompt);

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - new Date(startedAt).getTime();

      if (!result.ok) {
        await deps.researchRepo.updateLlmResult(researchId, provider, {
          status: 'failed',
          error: result.error.message,
          completedAt,
          durationMs,
        });
        return null;
      }

      const updateData: {
        status: 'completed';
        result: string;
        sources?: string[];
        completedAt: string;
        durationMs: number;
      } = {
        status: 'completed',
        result: result.value.content,
        completedAt,
        durationMs,
      };
      if (result.value.sources !== undefined) {
        updateData.sources = result.value.sources;
      }
      await deps.researchRepo.updateLlmResult(researchId, provider, updateData);

      // Report successful research call
      if (deps.reportLlmSuccess !== undefined) {
        deps.reportLlmSuccess(provider);
      }

      return {
        provider,
        model: getModelName(provider),
        content: result.value.content,
      };
    }
  );

  const llmResults = await Promise.all(llmPromises);
  const successfulResults: LlmCallResult[] = [];
  for (const r of llmResults) {
    if (r !== null) {
      successfulResults.push(r);
    }
  }

  // Synthesize results
  if (successfulResults.length > 0) {
    const externalReportsForSynthesis = research.externalReports?.map((report) => {
      const mapped: { content: string; model?: string } = { content: report.content };
      if (report.model !== undefined) {
        mapped.model = report.model;
      }
      return mapped;
    });

    const synthesisResult = await deps.synthesizer.synthesize(
      research.prompt,
      successfulResults.map((r) => ({ model: r.model, content: r.content })),
      externalReportsForSynthesis
    );

    if (!synthesisResult.ok) {
      await deps.researchRepo.update(researchId, {
        status: 'failed',
        synthesisError: synthesisResult.error.message,
        completedAt: new Date().toISOString(),
      });
    } else {
      await deps.researchRepo.update(researchId, {
        status: 'completed',
        synthesizedResult: synthesisResult.value,
        completedAt: new Date().toISOString(),
      });
      // Report successful synthesis
      if (deps.reportLlmSuccess !== undefined) {
        deps.reportLlmSuccess(research.synthesisLlm);
      }
    }
  } else {
    await deps.researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: 'All LLM calls failed',
      completedAt: new Date().toISOString(),
    });
  }

  // Send notification (best effort)
  const updatedResearch = await deps.researchRepo.findById(researchId);
  if (updatedResearch.ok && updatedResearch.value !== null) {
    await deps.notificationSender.sendResearchComplete(
      research.userId,
      researchId,
      updatedResearch.value.title
    );
  }
}

function getModelName(provider: LlmProvider): string {
  switch (provider) {
    case 'google':
      return 'Gemini 2.0 Flash';
    case 'openai':
      return 'GPT-4.1';
    case 'anthropic':
      return 'Claude Opus 4.5';
  }
}
