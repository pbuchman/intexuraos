/**
 * Gemini Flash-based issue pruning classifier.
 * Scores synced Linear issues as deletion candidates using LLM intelligence.
 *
 * NOTE: Tested via fake generate function injection in unit tests.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { IssuePruningClassifier, SyncedLinearIssue, PruneCandidate, LinearError } from '../../domain/index.js';

interface GeminiGenerateResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

interface GeminiGenerateError {
  code: string;
  message: string;
}

interface ClassifierDeps {
  generate: (prompt: string) => Promise<Result<GeminiGenerateResult, GeminiGenerateError>>;
  logger: Logger;
}

interface GeminiCandidateResponse {
  identifier: string;
  score: number;
  reason: string;
  category: PruneCandidate['category'];
}

const PRUNING_PROMPT_VERSION = '1.0.0';

function buildClassificationPrompt(
  issues: SyncedLinearIssue[],
  targetCount: number
): string {
  const issueData = issues.map((issue) => {
    const hasParent = issue.parentId !== null;
    return {
      identifier: issue.identifier,
      title: issue.title,
      state: issue.state,
      stateType: issue.stateType,
      hasParent,
      parentId: issue.parentId ?? null,
      labels: issue.labels.map((l) => l.name),
      priority: issue.priority,
      /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires explicit undefined fallback for optional property access @preserve */
      descriptionLength: issue.description?.length ?? 0,
      descriptionPreview: issue.description?.slice(0, 300) ?? '',
      /* v8 ignore stop @preserve */
      createdAt: issue.createdAt,
    };
  });

  return `You are a Linear issue triage assistant. Analyze these closed/cancelled Linear issues and select the top ${String(targetCount)} candidates for deletion.

PROMPT VERSION: ${PRUNING_PROMPT_VERSION}

DELETION PRIORITY (highest to lowest):
1. CANCELLED and DUPLICATE issues — always highest priority to delete
2. Sub-issues (have a parentId) — good candidates since parent retains context
3. Simple fix issues — short descriptions, no complex logic, review/investigate tasks without PR outcomes
4. Singular completed issues with low complexity — small changes, one-file fixes

KEEP (lower deletion priority):
- Parent issues with children — they provide context for sub-issues
- Issues with complex descriptions that document architecture decisions or debugging insights
- Issues with labels like "complex-task" — likely contain valuable context

INSTRUCTIONS:
- Return EXACTLY a JSON array of objects, nothing else (no markdown, no explanation)
- Each object: { "identifier": "INT-XXX", "score": <0-100>, "reason": "<1 sentence>", "category": "<cancelled|duplicate|sub-issue|simple-fix|review-only|other>" }
- Score 100 = most deletable, 0 = should not delete
- Sort by score descending
- Return at most ${String(targetCount)} candidates
- Only include candidates with score >= 40

ISSUES TO CLASSIFY:
${JSON.stringify(issueData, null, 2)}`;
}

export function createIssuePruningClassifier(deps: ClassifierDeps): IssuePruningClassifier {
  return {
    async classifyCandidates(
      issues: SyncedLinearIssue[],
      targetCount: number,
      logger: Logger
    ): Promise<Result<PruneCandidate[], LinearError>> {
      // Pre-filter: only send closed/cancelled issues to Gemini
      const closedIssues = issues.filter(
        (i) => i.stateType === 'completed' || i.stateType === 'cancelled'
      );

      if (closedIssues.length === 0) {
        logger.info('No closed/cancelled issues found for classification');
        return ok([]);
      }

      logger.info(
        { totalIssues: issues.length, closedIssues: closedIssues.length, targetCount },
        'Classifying issues for pruning'
      );

      const prompt = buildClassificationPrompt(closedIssues, targetCount);

      const result = await deps.generate(prompt);
      if (!result.ok) {
        logger.error({ error: result.error }, 'Gemini classification failed');
        return err({ code: 'INTERNAL_ERROR', message: `Classification failed: ${result.error.message}` });
      }

      logger.info(
        { usage: result.value.usage },
        'Gemini classification completed'
      );

      // Parse JSON response
      let parsed: GeminiCandidateResponse[];
      try {
        const content = result.value.content.trim();
        // Handle potential markdown code block wrapping
        const jsonContent = content.startsWith('[')
          ? content
          : content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        parsed = JSON.parse(jsonContent) as GeminiCandidateResponse[];
      } catch {
        logger.error(
          { responsePreview: result.value.content.slice(0, 200) },
          'Failed to parse classification response as JSON'
        );
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Failed to parse classification response as JSON',
        });
      }

      // Build a lookup map for enriching candidates with full issue data
      const issueMap = new Map(closedIssues.map((i) => [i.identifier, i]));

      const candidates: PruneCandidate[] = parsed
        .filter((c) => issueMap.has(c.identifier))
        .map((c) => {
          /* v8 ignore start -- upstream: filter ensures issue exists in map; impossible to reach undefined after has() check @preserve */
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const issue = issueMap.get(c.identifier)!;
          /* v8 ignore stop @preserve */
          return {
            id: issue.id,
            identifier: c.identifier,
            title: issue.title,
            score: c.score,
            reason: c.reason,
            category: c.category,
          };
        });

      logger.info({ candidateCount: candidates.length }, 'Classification complete');

      return ok(candidates);
    },
  };
}
