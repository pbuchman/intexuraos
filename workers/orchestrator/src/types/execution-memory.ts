export type ExecutionMemoryPromptMemoryType =
  | 'implementation_pattern'
  | 'verification_pattern'
  | 'pitfall_pattern';

export interface ExecutionMemoryPromptMemory {
  memoryId: string;
  title: string;
  memoryType: ExecutionMemoryPromptMemoryType;
  score: number;
  appliesWhen: string;
  action: string;
  avoid: string;
  verification: string;
}

export interface ExecutionMemoryPromptContext {
  applicationId: string;
  retrievalVersion: string;
  querySummary: string;
  matchedMemories: ExecutionMemoryPromptMemory[];
}
