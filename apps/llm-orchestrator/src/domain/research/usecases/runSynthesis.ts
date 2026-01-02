/**
 * Run synthesis use case.
 * Synthesizes results from completed LLM calls into a final research result.
 * Triggered when all LLMs complete OR when user confirms 'proceed' with partial failure.
 */

import type {
  LlmSynthesisProvider,
  NotificationSender,
  ResearchRepository,
} from '../ports/index.js';

export interface RunSynthesisDeps {
  researchRepo: ResearchRepository;
  synthesizer: LlmSynthesisProvider;
  notificationSender: NotificationSender;
  reportLlmSuccess?: () => void;
}

export async function runSynthesis(
  researchId: string,
  deps: RunSynthesisDeps
): Promise<{ ok: boolean; error?: string }> {
  const { researchRepo, synthesizer, notificationSender, reportLlmSuccess } = deps;

  const researchResult = await researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return { ok: false, error: 'Research not found' };
  }

  const research = researchResult.value;

  await researchRepo.update(researchId, { status: 'synthesizing' });

  const successfulResults = research.llmResults.filter((r) => r.status === 'completed');
  if (successfulResults.length === 0) {
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: 'No successful LLM results to synthesize',
      completedAt: new Date().toISOString(),
    });
    return { ok: false, error: 'No successful LLM results' };
  }

  const reports = successfulResults.map((r) => ({
    model: r.model,
    content: r.result ?? '',
  }));

  const externalReports = research.externalReports?.map((r) => {
    const report: { content: string; model?: string } = { content: r.content };
    if (r.model !== undefined) {
      report.model = r.model;
    }
    return report;
  });

  const synthesisResult = await synthesizer.synthesize(research.prompt, reports, externalReports);

  if (!synthesisResult.ok) {
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: synthesisResult.error.message,
      completedAt: new Date().toISOString(),
    });
    return { ok: false, error: synthesisResult.error.message };
  }

  const now = new Date();
  const startedAt = new Date(research.startedAt);
  const totalDurationMs = now.getTime() - startedAt.getTime();

  await researchRepo.update(researchId, {
    status: 'completed',
    synthesizedResult: synthesisResult.value,
    completedAt: now.toISOString(),
    totalDurationMs,
  });

  if (reportLlmSuccess !== undefined) {
    reportLlmSuccess();
  }

  void notificationSender.sendResearchComplete(research.userId, researchId, research.title);

  return { ok: true };
}
