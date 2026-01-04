export type RealismStyle = 'photorealistic' | 'cinematic illustration' | 'clean vector';

export interface ThumbnailPromptParameters {
  aspectRatio: '16:9';
  framing: string;
  textOnImage: 'none';
  realism: RealismStyle;
  people: string;
  logosTrademarks: 'none';
}

export interface ThumbnailPrompt {
  title: string;
  visualSummary: string;
  prompt: string;
  negativePrompt: string;
  parameters: ThumbnailPromptParameters;
}
