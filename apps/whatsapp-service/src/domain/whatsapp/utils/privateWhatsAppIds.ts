import { createHash } from 'node:crypto';

export function createPrivateWhatsAppChatId(
  sourceAccountId: string,
  matrixRoomId: string
): string {
  return createPrivateWhatsAppId(sourceAccountId, matrixRoomId);
}

export function createPrivateWhatsAppMessageId(
  sourceAccountId: string,
  matrixEventId: string
): string {
  return createPrivateWhatsAppId(sourceAccountId, matrixEventId);
}

export function createPrivateWhatsAppSenderId(sourceAccountId: string, senderKey: string): string {
  return createPrivateWhatsAppId(sourceAccountId, senderKey);
}

export function createPrivateWhatsAppSenderDayId(
  sourceAccountId: string,
  senderKey: string,
  eventDayKey: string
): string {
  return createPrivateWhatsAppId(sourceAccountId, `${senderKey}\0${eventDayKey}`);
}

function createPrivateWhatsAppId(sourceAccountId: string, matrixId: string): string {
  return createHash('sha256').update(`${sourceAccountId}\0${matrixId}`).digest('hex');
}
