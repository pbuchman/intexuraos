export type RealismStyle = 'photorealistic' | 'cinematic illustration' | 'clean vector';

export interface ThumbnailPromptParameters {
  framing: string;
  realism: RealismStyle;
  people: string;
}

export interface ThumbnailPrompt {
  title: string;
  visualSummary: string;
  prompt: string;
  negativePrompt: string;
  parameters: ThumbnailPromptParameters;
}
