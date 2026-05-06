import { err, ok, type Result } from '@intexuraos/common-core';
import type { EvidenceItem } from '../retrieval/types.js';
import type { ParsedFishingAnswer } from './parseFishingAnswer.js';

function isInsufficientEvidenceAnswer(answerMarkdown: string): boolean {
  const normalized = answerMarkdown.toLowerCase();
  return (
    normalized.includes('not enough evidence') ||
    normalized.includes('do not have enough evidence') ||
    normalized.includes('insufficient evidence') ||
    normalized.includes('brak wystarczających danych')
  );
}

export function validateCitations(
  answer: ParsedFishingAnswer,
  evidence: EvidenceItem[]
): Result<
  ParsedFishingAnswer,
  { code: 'CITATION_VALIDATION_FAILED'; message: string }
> {
  const evidenceIds = new Set(evidence.map((item) => item.id));

  for (const citation of answer.citations) {
    if (!evidenceIds.has(citation.sourceId)) {
      return err({
        code: 'CITATION_VALIDATION_FAILED',
        message: `Unknown citation sourceId: ${citation.sourceId}`,
      });
    }
  }

  if (answer.citations.length === 0 && !isInsufficientEvidenceAnswer(answer.answerMarkdown)) {
    return err({
      code: 'CITATION_VALIDATION_FAILED',
      message: 'Fishing Assistant answers must cite at least one source.',
    });
  }

  return ok(answer);
}
