/**
 * Port for accessing PromptVault settings.
 * Abstracts the Firestore repository behind an interface for DI.
 */
import type { Result } from '@intexuraos/common-core';

export interface PromptVaultSettingsError {
  code: 'INTERNAL_ERROR';
  message: string;
}

export interface PromptVaultSettings {
  promptVaultPageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVaultSettingsPort {
  getPromptVaultPageId(userId: string): Promise<Result<string | null, PromptVaultSettingsError>>;
  savePromptVaultPageId(
    userId: string,
    pageId: string
  ): Promise<Result<PromptVaultSettings, PromptVaultSettingsError>>;
}
