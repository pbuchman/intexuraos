export interface WhatsAppMessageDigestTemplateVerificationResult {
  ok: true;
  templateName: 'intexuraos_message_digest_v1';
  language: 'en_US';
  status: 'APPROVED';
}

export function verifyWhatsAppMessageDigestTemplate(options?: {
  environment?: Record<string, string | undefined>;
  fetchImplementation?: typeof fetch;
}): Promise<WhatsAppMessageDigestTemplateVerificationResult>;
