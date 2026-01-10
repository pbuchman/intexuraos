export interface CommandWithText {
  id: string;
  text: string;
  sourceType: string;
}

export interface CommandsRouterClient {
  getCommand(commandId: string): Promise<CommandWithText | null>;
}
