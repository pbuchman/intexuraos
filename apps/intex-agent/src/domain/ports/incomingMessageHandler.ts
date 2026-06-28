export type IntexIncomingMessageReplyContextSource =
  | 'inbound_user_message'
  | 'outbound_assistant_message';

export interface IntexIncomingMessageReplyContext {
  replyToWamid: string;
  source: IntexIncomingMessageReplyContextSource;
  text: string;
  truncated: boolean;
}

export interface IntexIncomingMessage {
  type: 'intex.message.ingest';
  userId: string;
  messageId: string;
  text: string;
  sourceType: string;
  whatsappSender?: string;
  replyContext?: IntexIncomingMessageReplyContext;
  timestamp: string;
}

export interface IncomingMessageHandlerResult {
  sessionId: string;
}

export interface IncomingMessageHandler {
  handle(input: IntexIncomingMessage): Promise<IncomingMessageHandlerResult>;
}
