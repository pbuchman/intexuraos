import type { WhatsAppInteractiveButton } from '@intexuraos/infra-pubsub';

export interface ApprovalButtonsConfig {
  actionId: string;
  extraButtons?: WhatsAppInteractiveButton[];
}

export function buildApprovalButtons(config: ApprovalButtonsConfig): WhatsAppInteractiveButton[] {
  const buttons: WhatsAppInteractiveButton[] = [
    {
      type: 'reply',
      reply: { id: `approve:${config.actionId}`, title: 'Approve' },
    },
    {
      type: 'reply',
      reply: { id: `reject:${config.actionId}`, title: 'Reject' },
    },
  ];
  if (config.extraButtons !== undefined) {
    buttons.push(...config.extraButtons);
  }
  return buttons;
}
