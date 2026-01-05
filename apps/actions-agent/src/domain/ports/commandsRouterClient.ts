export interface CommandWithText {
  id: string;
  text: string;
}

export interface CommandsRouterClient {
  getCommand(commandId: string): Promise<CommandWithText | null>;
}
