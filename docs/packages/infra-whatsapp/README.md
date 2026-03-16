# @intexuraos/infra-whatsapp

WhatsApp Cloud API wrapper providing message sending, media handling, and read receipt operations. Uses native `fetch` with no external SDK dependency.

**Version:** 3.3.0 | **Node:** >=22.0.0 | **Type:** ESM

## What It Wraps

- **External API:** WhatsApp Business Cloud API via Facebook Graph API (v22.0)
- **Base URL:** `https://graph.facebook.com/v22.0/`
- **Pattern:** Factory function returning a client object

## API Reference

### `createWhatsAppClient(config: WhatsAppConfig): WhatsAppClient`

Factory function that returns a client for WhatsApp Business API operations.

```ts
import { createWhatsAppClient } from '@intexuraos/infra-whatsapp';

const client = createWhatsAppClient({
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
});
```

**Methods on the returned client:**

| Method                            | Signature                                                                          | Description                                               |
| --------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `sendTextMessage(params)`         | `(params: SendMessageParams) => Promise<Result<SendMessageResult, WhatsAppError>>` | Send a text message, optionally as a reply                |
| `getMediaUrl(mediaId)`            | `(mediaId: string) => Promise<Result<MediaUrlInfo, WhatsAppError>>`                | Retrieve media URL and metadata from a media ID           |
| `downloadMedia(url)`              | `(url: string) => Promise<Result<Buffer, WhatsAppError>>`                          | Download media binary data from a media URL               |
| `markAsRead(messageId)`           | `(messageId: string) => Promise<Result<void, WhatsAppError>>`                      | Mark a message as read (displays blue check marks)        |
| `markAsReadWithTyping(messageId)` | `(messageId: string) => Promise<Result<void, WhatsAppError>>`                      | Mark as read and show typing indicator (up to 25 seconds) |

## Exported Types

| Type                | Description                                             |
| ------------------- | ------------------------------------------------------- |
| `WhatsAppClient`    | Client interface with all five methods                  |
| `WhatsAppConfig`    | Configuration with `accessToken` and `phoneNumberId`    |
| `SendMessageParams` | Parameters for `sendTextMessage`                        |
| `SendMessageResult` | Result containing the sent `messageId`                  |
| `MediaUrlInfo`      | Media metadata: `url`, `mimeType`, `sha256`, `fileSize` |
| `WhatsAppError`     | Error with `code`, `message`, optional `statusCode`     |

### WhatsAppConfig

```ts
interface WhatsAppConfig {
  accessToken: string; // WhatsApp Business API access token
  phoneNumberId: string; // WhatsApp phone number ID
}
```

### SendMessageParams

```ts
interface SendMessageParams {
  to: string; // Recipient phone number (E.164 format)
  message: string; // Message text body
  replyToMessageId?: string; // Optional message ID to reply to
}
```

### SendMessageResult

```ts
interface SendMessageResult {
  messageId: string; // WhatsApp message ID of the sent message
}
```

### MediaUrlInfo

```ts
interface MediaUrlInfo {
  url: string; // Temporary download URL
  mimeType: string; // e.g., 'audio/ogg', 'image/jpeg'
  sha256: string; // SHA-256 hash of the media
  fileSize: number; // File size in bytes
}
```

### WhatsAppError

```ts
interface WhatsAppError {
  code: 'API_ERROR' | 'NETWORK_ERROR' | 'INVALID_CONFIG' | 'TIMEOUT';
  message: string;
  statusCode?: number; // HTTP status code when available
}
```

## Configuration

### Environment Variables

| Variable                              | Description                 | Required |
| ------------------------------------- | --------------------------- | -------- |
| `INTEXURAOS_WHATSAPP_ACCESS_TOKEN`    | WhatsApp Business API token | Yes      |
| `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID    | Yes      |

## Error Handling

All methods return `Result<T, WhatsAppError>`. Error codes:

| Error Code       | Description                                      |
| ---------------- | ------------------------------------------------ |
| `API_ERROR`      | Non-OK HTTP response from WhatsApp API           |
| `NETWORK_ERROR`  | `fetch` threw an error (DNS, connection refused) |
| `TIMEOUT`        | Operation timed out via `AbortController`        |
| `INVALID_CONFIG` | Reserved for configuration validation errors     |

## Implementation Notes

- **Timeouts:** Media download and mark-as-read operations use a 30-second `AbortController` timeout
- **Reply threading:** `sendTextMessage` supports reply context via `replyToMessageId`, which sets the `context.message_id` field in the API payload
- **Typing indicator:** `markAsReadWithTyping` combines mark-as-read with a typing indicator that displays for up to 25 seconds or until a message is sent
- **Media workflow:** Retrieve the media URL with `getMediaUrl(mediaId)`, then download the binary with `downloadMedia(url)`. Both require the access token.
- **No retry logic:** The client does not retry failed requests; consumers handle retry strategies

## Used By

| App / Package      | Purpose                                        |
| ------------------ | ---------------------------------------------- |
| `whatsapp-service` | Message sending, media handling, read receipts |

## Recent Changes

| Commit     | Description                                            |
| ---------- | ------------------------------------------------------ |
| `37551ab3` | Fix WhatsApp voice note transcription bugs             |
| `9f6505a7` | Address remaining PR #533 review feedback              |
| `f7004bdf` | Address PR #533 review issues                          |
| `16f6d0dc` | Replace 'message saved' confirmation with read receipt |
