import { OpenRouterToolCallingModels } from '@intexuraos/llm-contract';

export {
  INTEX_AGENT_SYSTEM_PROMPT,
  buildIntexAgentSystemPrompt,
  type BuildIntexAgentSystemPromptInput,
} from '@intexuraos/llm-prompts';

export const INTEX_AGENT_MODEL = OpenRouterToolCallingModels.Gemini3FlashPreview;
export const INTEX_AGENT_RUNNER_PROMPT_TYPE = 'intex-agent-whatsapp-session';
