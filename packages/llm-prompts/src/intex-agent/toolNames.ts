import { z } from 'zod';

export const INTEX_AGENT_TOOL_NAMES = [
  'create_note',
  'create_calendar_event',
  'query_calendar_events',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'get_user_preferences',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
] as const;

export const IntexAgentToolNameSchema = z.enum(INTEX_AGENT_TOOL_NAMES);

export type IntexAgentPromptToolName = z.infer<typeof IntexAgentToolNameSchema>;
