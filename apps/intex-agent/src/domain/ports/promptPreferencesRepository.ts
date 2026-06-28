import type {
  IntexAgentPromptPreferenceVersion,
  IntexAgentPromptPreferenceVersionSummary,
  IntexAgentPromptPreferences,
  PreferenceUpdatedBy,
} from '../preferences/promptPreferences.js';

export interface PromptPreferencesRepository {
  getCurrent(userId: string): Promise<IntexAgentPromptPreferences>;
  listVersions(userId: string): Promise<IntexAgentPromptPreferenceVersionSummary[]>;
  getVersion(userId: string, version: number): Promise<IntexAgentPromptPreferenceVersion | null>;
  addItem(input: AddPromptPreferenceItemRepositoryInput): Promise<IntexAgentPromptPreferences>;
  updateItem(input: UpdatePromptPreferenceItemRepositoryInput): Promise<IntexAgentPromptPreferences>;
  deleteItem(input: DeletePromptPreferenceItemRepositoryInput): Promise<IntexAgentPromptPreferences>;
}

export interface AddPromptPreferenceItemRepositoryInput {
  userId: string;
  text: string;
  expectedVersion: number;
  updatedBy: PreferenceUpdatedBy;
}

export interface UpdatePromptPreferenceItemRepositoryInput {
  userId: string;
  itemId: string;
  text: string;
  expectedVersion: number;
  updatedBy: PreferenceUpdatedBy;
}

export interface DeletePromptPreferenceItemRepositoryInput {
  userId: string;
  itemId: string;
  expectedVersion: number;
  updatedBy: PreferenceUpdatedBy;
}
