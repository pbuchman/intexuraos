export interface CommandWithText {
  id: string;
  text: string;
  sourceType: string;
}

export interface CommandsAgentClient {
  getCommand(commandId: string): Promise<CommandWithText | null>;
}
