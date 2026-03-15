# Agent Reference: @intexuraos/infra-whatsapp

## Identity

- **Package:** `@intexuraos/infra-whatsapp`
- **Version:** 3.3.0
- **Purpose:** WhatsApp Business Cloud API wrapper for messaging and media
- **External SDK:** None (raw `fetch`)
- **API Version:** v22.0
- **API Base:** `https://graph.facebook.com/v22.0/`

## Exports

```ts
// Factory
export function createWhatsAppClient(config: WhatsAppConfig): WhatsAppClient;

// Types
export type { WhatsAppClient };
export type { WhatsAppConfig, SendMessageParams, SendMessageResult, MediaUrlInfo, WhatsAppError };
```

## Key Interfaces

```ts
interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

interface WhatsAppClient {
  sendTextMessage(params: SendMessageParams): Promise<Result<SendMessageResult, WhatsAppError>>;
  getMediaUrl(mediaId: string): Promise<Result<MediaUrlInfo, WhatsAppError>>;
  downloadMedia(url: string): Promise<Result<Buffer, WhatsAppError>>;
  markAsRead(messageId: string): Promise<Result<void, WhatsAppError>>;
  markAsReadWithTyping(messageId: string): Promise<Result<void, WhatsAppError>>;
}

interface SendMessageParams {
  to: string;
  message: string;
  replyToMessageId?: string;
}

interface SendMessageResult {
  messageId: string;
}

interface MediaUrlInfo {
  url: string;
  mimeType: string;
  sha256: string;
  fileSize: number;
}

interface WhatsAppError {
  code: 'API_ERROR' | 'NETWORK_ERROR' | 'INVALID_CONFIG' | 'TIMEOUT';
  message: string;
  statusCode?: number;
}
```

## Usage Patterns

### Send a text message

```ts
import { createWhatsAppClient } from '@intexuraos/infra-whatsapp';

const client = createWhatsAppClient({
  accessToken: env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: env.INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID,
});

const result = await client.sendTextMessage({
  to: '+1234567890',
  message: 'Hello from IntexuraOS',
});
if (result.ok) {
  // result.data.messageId
}
```

### Send a reply

```ts
const result = await client.sendTextMessage({
  to: '+1234567890',
  message: 'Replying to your message',
  replyToMessageId: 'wamid.xxx',
});
```

### Download media (two-step)

```ts
const mediaInfo = await client.getMediaUrl(mediaId);
if (mediaInfo.ok) {
  const buffer = await client.downloadMedia(mediaInfo.data.url);
  if (buffer.ok) {
    // buffer.data is a Buffer with the file contents
  }
}
```

### Mark as read with typing indicator

```ts
await client.markAsReadWithTyping(incomingMessageId);
```

### Error handling

```ts
if (!result.ok) {
  switch (result.error.code) {
    case 'API_ERROR': // non-OK HTTP response, check statusCode
    case 'NETWORK_ERROR': // fetch threw
    case 'TIMEOUT': // AbortController timeout (30s)
    case 'INVALID_CONFIG': // reserved
  }
}
```

## Dependencies

- `@intexuraos/common-core` -- Result types, getErrorMessage

## Constants

- `WHATSAPP_API_VERSION`: `v22.0`
- `MEDIA_DOWNLOAD_TIMEOUT_MS`: 30000
- `MARK_AS_READ_TIMEOUT_MS`: 30000
