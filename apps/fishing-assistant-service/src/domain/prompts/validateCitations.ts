import { err, ok, type Result } from '@intexuraos/common-core';
import type { EvidenceItem } from '../retrieval/types.js';
import type { ParsedFishingAnswer } from './parseFishingAnswer.js';

export interface CitationValidationOptions {
  requireKnowledgeBaseCitation?: boolean;
}

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
  evidence: EvidenceItem[],
  options: CitationValidationOptions = {}
): Result<
  ParsedFishingAnswer,
  { code: 'CITATION_VALIDATION_FAILED'; message: string }
> {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  for (const citation of answer.citations) {
    if (!evidenceById.has(citation.sourceId)) {
      return err({
        code: 'CITATION_VALIDATION_FAILED',
        message: `Unknown citation sourceId: ${citation.sourceId}`,
      });
    }
  }

  const insufficientEvidenceAnswer = isInsufficientEvidenceAnswer(answer.answerMarkdown);
  if (answer.citations.length === 0 && !insufficientEvidenceAnswer) {
    return err({
      code: 'CITATION_VALIDATION_FAILED',
      message: 'Fishing Assistant answers must cite at least one source.',
    });
  }

  const hasKnowledgeBaseEvidence = evidence.some((item) => item.sourceType === 'knowledge_page');
  const hasKnowledgeBaseCitation = answer.citations.some(
    (citation) => evidenceById.get(citation.sourceId)?.sourceType === 'knowledge_page'
  );
  if (
    options.requireKnowledgeBaseCitation === true &&
    hasKnowledgeBaseEvidence &&
    !hasKnowledgeBaseCitation &&
    !insufficientEvidenceAnswer
  ) {
    return err({
      code: 'CITATION_VALIDATION_FAILED',
      message: 'Fishing Assistant answers must cite at least one knowledge-base source.',
    });
  }

  return ok(answer);
}
