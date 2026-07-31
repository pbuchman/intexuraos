import type {
  MessageDigestDeliveryReadiness,
  MessageDigestWhatsAppClient,
} from '../ports/messageDigestClients.js';

export async function getMessageDigestDeliveryReadiness(
  input: { userId: string },
  dependencies: { whatsappClient: Pick<MessageDigestWhatsAppClient, 'getDeliveryReadiness'> }
): Promise<
  | { ok: true; readiness: MessageDigestDeliveryReadiness }
  | { ok: false; code: 'INVALID_REQUEST' | 'READINESS_UNAVAILABLE' }
> {
  const userId = input.userId.trim();
  if (userId === '') return { ok: false, code: 'INVALID_REQUEST' };
  const result = await dependencies.whatsappClient.getDeliveryReadiness(userId);
  return result.ok
    ? { ok: true, readiness: result.value }
    : { ok: false, code: 'READINESS_UNAVAILABLE' };
}
