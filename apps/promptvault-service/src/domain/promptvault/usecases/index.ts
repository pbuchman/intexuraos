/**
 * Use cases for the PromptVault domain.
 */
export { createPrompt, createCreatePromptUseCase } from './CreatePromptUseCase.js';
export type { CreatePromptUseCaseInput } from './CreatePromptUseCase.js';

export { listPrompts, createListPromptsUseCase } from './ListPromptsUseCase.js';
export type { ListPromptsUseCaseInput } from './ListPromptsUseCase.js';

export { getPrompt, createGetPromptUseCase } from './GetPromptUseCase.js';
export type { GetPromptUseCaseInput } from './GetPromptUseCase.js';

export { updatePrompt, createUpdatePromptUseCase } from './UpdatePromptUseCase.js';
export type { UpdatePromptUseCaseInput } from './UpdatePromptUseCase.js';
