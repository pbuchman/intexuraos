import type { ToolDefinition } from '@intexuraos/llm-contract';

export interface ToolExecutionContext {
  userId: string;
}

export interface ServiceToolInfo {
  key: string;
  name: string;
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
}

export interface ToolRegistry {
  getToolsForService(serviceKey: string, context?: ToolExecutionContext): Promise<ToolDefinition[]>;
  getToolsForServices(serviceKeys: string[], context?: ToolExecutionContext): Promise<ToolDefinition[]>;
  listServiceTools(): Promise<ServiceToolInfo[]>;
  refreshAll(): Promise<void>;
}
