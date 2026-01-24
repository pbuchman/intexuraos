/**
 * Image-related prompts for LLM operations.
 */

export {
  thumbnailPrompt,
  type ThumbnailPromptInput,
  type ThumbnailPromptDeps,
} from './thumbnailPrompt.js';

export {
  generateThumbnailPrompt,
  type RealismStyle,
  type ThumbnailPrompt,
  type ThumbnailPromptParameters,
  type ThumbnailPromptError,
  type ThumbnailPromptResult,
} from './generateThumbnailPrompt.js';
