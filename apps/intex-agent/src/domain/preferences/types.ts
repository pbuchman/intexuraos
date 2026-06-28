export interface IntexAgentPreferences {
  userId: string;
  instructions: string;
  externalSave?: IntexAgentExternalSavePreferences;
  updatedAt: string;
}

export interface IntexAgentPreferencesUpdate {
  instructions: string;
  externalSave?: IntexAgentExternalSavePreferences;
}

export interface IntexAgentExternalSavePreferences {
  enabled: boolean;
  endpointUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  source: string;
}

export interface ExternalSaveConnectionTestResult {
  ok: boolean;
  status: 'success' | 'failure';
  message: string;
}

export interface ExternalSaveConnectionTestPort {
  testConnection(
    config: IntexAgentExternalSavePreferences
  ): Promise<ExternalSaveConnectionTestResult>;
}

export const DEFAULT_EXTERNAL_SAVE_SOURCE = 'ios-shortcuts';
export const MASKED_EXTERNAL_SAVE_SECRET = '************';
