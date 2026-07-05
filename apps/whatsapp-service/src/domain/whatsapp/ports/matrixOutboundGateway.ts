export type MatrixOutboundTarget = 'intex_agent';

export interface MatrixOutboundReadinessInput {
  sourceAccountId: string;
  target: MatrixOutboundTarget;
}

export type MatrixOutboundReadinessResult =
  | { status: 'ready' }
  | { status: 'setup_required'; reason: string }
  | { status: 'error'; message: string };

export interface MatrixOutboundSendInput extends MatrixOutboundReadinessInput {
  text: string;
  idempotencyKey?: string;
}

export type MatrixOutboundSendResult =
  | { status: 'sent'; matrixEventId: string }
  | { status: 'setup_required'; reason: string }
  | { status: 'error'; message: string };

export interface MatrixOutboundGateway {
  getDeliveryReadiness(
    input: MatrixOutboundReadinessInput
  ): Promise<MatrixOutboundReadinessResult>;

  sendMessage(input: MatrixOutboundSendInput): Promise<MatrixOutboundSendResult>;
}
