import type { ToolDefinition } from '@intexuraos/llm-contract';

export interface ServiceToolInfo {
  key: string;
  name: string;
  tools: { name: string; description: string }[];
}

export interface ToolRegistry {
  getToolsForService(serviceKey: string): Promise<ToolDefinition[]>;
  getToolsForServices(serviceKeys: string[]): Promise<ToolDefinition[]>;
  listServiceTools(): Promise<ServiceToolInfo[]>;
  refreshAll(): Promise<void>;
}
