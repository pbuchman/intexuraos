# whatsapp-service — Agent Interface

> Machine-readable interface definition for AI agents interacting with whatsapp-service.

---

## Identity

| Field    | Value                                                               |
| --------  | -------------------------------------------------------------------  |
| **Name** | whatsapp-service                                                    |
| **Role** | WhatsApp Integration Service                                        |
| **Goal** | Receive WhatsApp messages, process media, and extract link previews |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface WhatsAppServiceTools {
  // List user's WhatsApp messages
  listMessages(params?: { limit?: number; cursor?: string }): Promise<MessagesListResult>;

  // Get signed URL for message media
  getMessageMedia(messageId: string): Promise<SignedUrlResult>;

  // Get signed URL for message thumbnail
  getMessageThumbnail(messageId: string): Promise<SignedUrlResult>;

  // Delete a message
  deleteMessage(messageId: string): Promise<void>;
}
```

### Types

```typescript
type MediaType = 'text' | 'image' | 'audio';
type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';
type LinkPreviewStatus = 'pending' | 'completed' | 'failed';

interface WhatsAppMessage {
  id: string;
  text: string;
  fromNumber: string;
  timestamp: string;
  receivedAt: string;
  mediaType: MediaType;
  hasMedia: boolean;
  caption?: string;
  transcriptionStatus?: TranscriptionStatus;
  transcription?: string;
  transcriptionError?: {
    code: string;
    message: string;
  };
  linkPreview?: {
    status: LinkPreviewStatus;
    previews?: LinkPreviewData[];
    error?: {
      code: string;
      message: string;
    };
  };
}

interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
}

interface MessagesListResult {
  messages: WhatsAppMessage[];
  fromNumber: string | null;
  nextCursor?: string;
}

interface SignedUrlResult {
  url: string;
  expiresAt: string;
}
```

---

## Constraints

| Rule                    | Description                               |
| -----------------------  | -----------------------------------------  |
| **Phone Number Mapped** | User must have WhatsApp number registered |
| **Media Expiration**    | Signed URLs expire after 15 minutes       |
| **Ownership**           | Users can only access their own messages  |
| **Pagination**          | Maximum 100 messages per request          |

---

## Usage Patterns

### List Recent Messages

```typescript
const result = await listMessages({ limit: 50 });
// result.messages contains message objects with text, media info, transcriptions
// result.fromNumber shows user's registered WhatsApp number
```

### Access Message Media

```typescript
const media = await getMessageMedia(messageId);
// media.url is a signed URL valid for 15 minutes
// Use for displaying original images or playing audio
```

### Access Thumbnail

```typescript
const thumbnail = await getMessageThumbnail(messageId);
// thumbnail.url provides 256px max edge thumbnail
// Use for message previews in lists
```

---

## Event Processing

WhatsApp messages trigger automatic processing:

1. **Webhook Receipt** - Message received from WhatsApp Business API
2. **Media Processing** - Images/audio downloaded to Cloud Storage
3. **Thumbnail Generation** - 256px thumbnails created for images
4. **Audio Transcription** - Gemini transcribes audio messages
5. **Link Preview Extraction** - OpenGraph metadata fetched for URLs

---

## Internal Endpoints

| Method | Path                     | Purpose                                         |
| ------  | ------------------------  | -----------------------------------------------  |
| POST   | `/internal/send-message` | Send WhatsApp message (called by actions-agent) |
| POST   | `/webhook`               | Receive WhatsApp webhook events                 |

---

## Error Handling

| Error Code         | Description                                    |
| ------------------  | ----------------------------------------------  |
| `NOT_FOUND`        | Message not found or not owned by user         |
| `DOWNSTREAM_ERROR` | Failed to communicate with storage or WhatsApp |

---

**Last updated:** 2026-01-19
