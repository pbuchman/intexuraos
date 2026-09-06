import type {
  IntexAgentPreferences,
  IntexAgentPreferencesUpdate,
} from '../preferences/types.js';

export interface PreferencesRepository {
  getPreferences(userId: string): Promise<IntexAgentPreferences | null>;
  savePreferences(
    userId: string,
    update: IntexAgentPreferencesUpdate
  ): Promise<IntexAgentPreferences>;
  deletePreferences(userId: string): Promise<void>;
}
