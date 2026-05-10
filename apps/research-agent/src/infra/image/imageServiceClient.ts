/**
 * HTTP client for image-service internal API.
 * Provides access to thumbnail prompt generation, image generation, and deletion.
 */

export {
  createImageServiceClient,
  type ImageServiceConfig,
  type ImageServiceError,
  type ThumbnailPrompt,
  type GeneratedImageData,
  type PromptModel,
  type ImageModel,
  type GenerateImageOptions,
  type GeneratePromptOptions,
  type ImageServiceClient,
} from '@intexuraos/internal-clients';
