import type { FishingChatMessage } from '../models/chat.js';
import type { KnowledgePageRepository } from '../ports/knowledgeRepositories.js';
import type { EvidenceItem } from './types.js';

const FULL_PAGE_FOLLOW_UP =
  /(full|entire|whole).*(recipe|receipt|page|text)|ca[lł]y.*(przepis|tekst|stron[ay])|pe[lł]ny.*(przepis|tekst)/i;

export interface FollowUpExpansionDeps {
  pageRepository: Pick<KnowledgePageRepository, 'getByIdForUser'>;
}

export interface FollowUpExpansionInput {
  userId: string;
  latestUserMessage: string;
  recentMessages: FishingChatMessage[];
}

export async function expandFollowUpEvidence(
  deps: FollowUpExpansionDeps,
  input: FollowUpExpansionInput
): Promise<EvidenceItem[]> {
  if (!FULL_PAGE_FOLLOW_UP.test(input.latestUserMessage)) {
    return [];
  }

  const pageIds = new Set<string>();
  for (const message of input.recentMessages.slice(-6)) {
    for (const citation of message.citations) {
      if (citation.sourceType !== 'knowledge_page' || citation.pageId === undefined) {
        continue;
      }
      pageIds.add(citation.pageId);
    }
  }

  const evidence: EvidenceItem[] = [];
  let index = 1;
  for (const pageId of [...pageIds].slice(0, 3)) {
    const pageResult = await deps.pageRepository.getByIdForUser({
      userId: input.userId,
      pageId,
    });
    if (!pageResult.ok || pageResult.value === null) continue;
    evidence.push({
      id: `S_FULL_${String(index)}`,
      sourceType: 'knowledge_page',
      title: pageResult.value.title,
      text: pageResult.value.rawText,
      quote: pageResult.value.rawText,
      url: `/fishing-assistant/knowledge/pages/${pageResult.value.id}`,
      score: 1,
      metadata: { pageId: pageResult.value.id },
    });
    index += 1;
  }

  return evidence;
}
