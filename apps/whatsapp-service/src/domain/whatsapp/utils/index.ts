/**
 * Domain utilities for WhatsApp.
 */
export { normalizePhoneNumber } from './phoneNumber.js';
export { getExtensionFromMimeType } from './mimeType.js';
export {
  createPrivateWhatsAppChatId,
  createPrivateWhatsAppMessageId,
  createPrivateWhatsAppSenderDayId,
  createPrivateWhatsAppSenderId,
} from './privateWhatsAppIds.js';
export type { Logger } from './logger.js';
