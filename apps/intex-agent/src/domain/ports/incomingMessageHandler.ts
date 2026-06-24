export interface IntexIncomingMessage {
  type: 'intex.message.ingest';
  userId: string;
  messageId: string;
  text: string;
  sourceType: string;
  whatsappSender?: string;
  timestamp: string;
}

export interface IncomingMessageHandlerResult {
  sessionId: string;
}

export interface IncomingMessageHandler {
  handle(input: IntexIncomingMessage): Promise<IncomingMessageHandlerResult>;
}
