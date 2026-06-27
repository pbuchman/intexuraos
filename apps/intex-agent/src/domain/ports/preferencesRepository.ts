import type { IntexAgentPreferences } from '../preferences/types.js';

export interface PreferencesRepository {
  getPreferences(userId: string): Promise<IntexAgentPreferences | null>;
  savePreferences(
    userId: string,
    update: { instructions: string }
  ): Promise<IntexAgentPreferences>;
  deletePreferences(userId: string): Promise<void>;
}