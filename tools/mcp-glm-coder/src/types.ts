export type TaskType = 'generate_code' | 'generate_tests' | 'refactor';

export interface AttemptMetrics {
  attemptNumber: number;
  latencyMs: number;
  success: boolean;
  errorCategory?: string;
  tokensEstimate: number;
}

export interface GLMCallMetrics {
  id: string;
  timestamp: string;
  sessionId: string;
  taskType: TaskType;
  taskDescription: string;
  contextFilesCount: number;
  contextTokensEstimate: number;
  targetFile: string | null;
  attempts: AttemptMetrics[];
  finalSuccess: boolean;
  totalLatencyMs: number;
  outputTokensEstimate: number;
  validationErrors: string[];
  manualEditsRequired?: boolean;
  usedInFinalCode?: boolean;
  userFeedback?: 'good' | 'bad' | 'mixed';
}

export interface PostHocEvent {
  callId: string;
  manualEditsRequired: boolean;
  timestamp: string;
  editedFile: string;
}

export interface GLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface GenerateCodeParams {
  task: string;
  contextFiles?: string[];
  targetFile?: string;
  style?: 'minimal' | 'documented' | 'defensive';
}

export interface GenerateTestsParams {
  sourceFile: string;
  testStyle?: 'unit' | 'integration';
  coverage?: 'full' | 'happy-path';
}
