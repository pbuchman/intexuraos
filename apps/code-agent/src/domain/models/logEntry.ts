import type { Timestamp } from '@google-cloud/firestore';

export interface LogEntry {
  sequence: number;
  type: 'system' | 'assistant_text' | 'tool_call' | 'tool_result' | 'result' | 'raw';
  timestamp: Timestamp;

  systemSubtype?: string;
  hookName?: string;
  hookExitCode?: number;
  hookOutput?: string;
  model?: string;
  toolCount?: number;
  mcpServers?: { name: string; status: string }[];

  text?: string;

  toolName?: string;
  toolContext?: string;

  content?: string;
  isError?: boolean;

  resultType?: 'success' | 'error';
  durationMs?: number;
  numTurns?: number;
  totalCostUsd?: number;
  errorMessage?: string;

  rawText?: string;
}
