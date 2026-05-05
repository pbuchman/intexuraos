import type { FishingContentType } from './types.js';

const TYPE_KEYWORDS: { type: FishingContentType; keywords: readonly string[] }[] = [
  { type: 'recipe', keywords: ['przepis', '300 g', '150 g', 'łyżeczki', 'ml', 'otrębów'] },
  { type: 'additive', keywords: ['dodatek', 'dodatki', 'atraktor', 'olej', 'klej', 'bentonit', 'melasa'] },
  { type: 'species', keywords: ['gatunek', 'gatunki', 'leszcz', 'płoć', 'karaś', 'karp', 'lin'] },
  { type: 'theory', keywords: ['dlaczego', 'teoria', 'ciśnienie', 'temperatura', 'metabolizm'] },
  { type: 'qna', keywords: ['pytanie', 'pytania', 'odpowiedź', 'q&a', 'faq', '?'] },
  { type: 'guide', keywords: ['poradnik', 'jak ', 'taktyka', 'najpierw', 'krok', 'gruntowanie'] },
];

export function classifyPage(text: string, title = ''): FishingContentType {
  const haystack = `${title}\n${text}`.toLowerCase();
  for (const candidate of TYPE_KEYWORDS) {
    if (candidate.keywords.some((keyword) => haystack.includes(keyword))) {
      return candidate.type;
    }
  }
  return 'other';
}
