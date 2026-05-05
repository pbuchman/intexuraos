export const FISHING_CONTENT_TYPES = [
  'recipe',
  'guide',
  'species',
  'theory',
  'additive',
  'qna',
  'other',
] as const;

export type FishingContentType = (typeof FISHING_CONTENT_TYPES)[number];

export interface TitleInferencePort {
  generateTitle(content: string): Promise<string>;
}

export interface PageChunk {
  index: number;
  heading: string | null;
  text: string;
  searchableText: string;
  charCount: number;
  contentType: FishingContentType;
}

export interface ChunkPageInput {
  rawText: string;
  folderPath?: readonly string[];
  titleInference?: TitleInferencePort;
}

export interface ChunkPageResult {
  title: string;
  normalizedText: string;
  contentType: FishingContentType;
  chunks: PageChunk[];
}
