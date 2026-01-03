# WhatsApp Service Domain

## Overview

Handles WhatsApp Business API integration including webhook processing, media handling (images, audio), transcription, and link preview extraction. Implements fire-and-forget patterns for async processing after webhook acknowledgment.

## Domain Structure

```
apps/whatsapp-service/src/domain/
└── whatsapp/
    ├── models/
    │   ├── WhatsAppMessage.ts
    │   ├── LinkPreview.ts
    │   └── error.ts
    ├── ports/
    │   ├── repositories.ts
    │   ├── mediaStorage.ts
    │   ├── whatsappCloudApi.ts
    │   ├── thumbnailGenerator.ts
    │   ├── transcriptionService.ts
    │   ├── linkPreviewFetcher.ts
    │   └── messageSender.ts
    ├── usecases/
    │   ├── processAudioMessage.ts
    │   ├── processImageMessage.ts
    │   ├── transcribeAudio.ts
    │   └── extractLinkPreviews.ts
    ├── utils/
    │   ├── logger.ts
    │   ├── mimeType.ts
    │   └── phoneNumber.ts
    └── index.ts
```

## Models

### WhatsAppMessage

Core entity representing a message received from WhatsApp.

| Field              | Type                           | Description                             |
| ------------------ | ------------------------------ | --------------------------------------- |
| `id`               | `string`                       | Firestore document ID                   |
| `userId`           | `string`                       | Owner user ID                           |
| `waMessageId`      | `string`                       | WhatsApp message ID                     |
| `fromNumber`       | `string`                       | Sender phone number                     |
| `toNumber`         | `string`                       | Recipient phone number                  |
| `text`             | `string`                       | Message text (or caption)               |
| `mediaType`        | `'text' \| 'image' \| 'audio'` | Message type                            |
| `media`            | `MediaInfo?`                   | Media metadata (id, mimeType, fileSize) |
| `gcsPath`          | `string?`                      | GCS path for media                      |
| `thumbnailGcsPath` | `string?`                      | GCS path for image thumbnail            |
| `timestamp`        | `string`                       | WhatsApp timestamp                      |
| `receivedAt`       | `string`                       | Server receive time                     |
| `transcription`    | `TranscriptionState?`          | Audio transcription state               |
| `linkPreview`      | `LinkPreviewState?`            | Link preview extraction state           |

**File:** `domain/whatsapp/models/WhatsAppMessage.ts`

### TranscriptionState

| Status       | Meaning                   |
| ------------ | ------------------------- |
| `pending`    | Awaiting transcription    |
| `processing` | Transcription in progress |
| `completed`  | Transcription finished    |
| `failed`     | Transcription failed      |

### LinkPreviewState

| Status      | Meaning                         |
| ----------- | ------------------------------- |
| `pending`   | Fetching URL metadata           |
| `completed` | Previews extracted successfully |
| `failed`    | All URL fetches failed          |

### LinkPreview

| Field         | Type      | Description      |
| ------------- | --------- | ---------------- |
| `url`         | `string`  | Original URL     |
| `title`       | `string?` | Page title       |
| `description` | `string?` | Meta description |
| `image`       | `string?` | OG image URL     |
| `siteName`    | `string?` | Site name        |

**File:** `domain/whatsapp/models/LinkPreview.ts`

### WhatsAppError

| Field     | Type                       | Description        |
| --------- | -------------------------- | ------------------ |
| `code`    | `WhatsAppErrorCode`        | Error category     |
| `message` | `string`                   | Human-readable msg |
| `details` | `Record<string, unknown>?` | Extra context      |

**Error Codes:** `NOT_FOUND`, `VALIDATION_ERROR`, `PERSISTENCE_ERROR`, `INTERNAL_ERROR`

**File:** `domain/whatsapp/models/error.ts`

## Ports

### WhatsAppMessageRepository

**Purpose:** Persist and query WhatsApp messages

**File:** `domain/whatsapp/ports/repositories.ts`

| Method                                      | Returns                 | Description                |
| ------------------------------------------- | ----------------------- | -------------------------- |
| `saveMessage(message)`                      | `Promise<Result<{id}>>` | Save new message           |
| `updateTranscription(userId, msgId, state)` | `Promise<Result<void>>` | Update transcription state |
| `updateLinkPreview(userId, msgId, state)`   | `Promise<Result<void>>` | Update link preview state  |

**Implemented by:** `infra/firestore/messageRepository.ts`

### WhatsAppWebhookEventRepository

**Purpose:** Track webhook event processing status

| Method                                     | Returns                 | Description              |
| ------------------------------------------ | ----------------------- | ------------------------ |
| `createEvent(data)`                        | `Promise<Result<{id}>>` | Create tracking event    |
| `updateEventStatus(eventId, status, meta)` | `Promise<void>`         | Update processing status |

**Status Values:** `pending`, `processing`, `completed`, `failed`

**Implemented by:** `infra/firestore/webhookEventRepository.ts`

### MediaStoragePort

**Purpose:** Upload media files to GCS

| Method                                           | Returns                      | Description      |
| ------------------------------------------------ | ---------------------------- | ---------------- |
| `upload(userId, msgId, mediaId, ext, buf, mime)` | `Promise<Result<{gcsPath}>>` | Upload original  |
| `uploadThumbnail(...)`                           | `Promise<Result<{gcsPath}>>` | Upload thumbnail |

**Implemented by:** `infra/gcs/mediaStorage.ts`

### WhatsAppCloudApiPort

**Purpose:** Interact with WhatsApp Cloud API

| Method                 | Returns                   | Description           |
| ---------------------- | ------------------------- | --------------------- |
| `getMediaUrl(mediaId)` | `Promise<Result<{url}>>`  | Get download URL      |
| `downloadMedia(url)`   | `Promise<Result<Buffer>>` | Download media binary |

**Implemented by:** `infra/whatsapp/cloudApiClient.ts`

### ThumbnailGeneratorPort

**Purpose:** Generate image thumbnails

| Method             | Returns                               | Description      |
| ------------------ | ------------------------------------- | ---------------- |
| `generate(buffer)` | `Promise<Result<{buffer, mimeType}>>` | Create thumbnail |

**Implemented by:** `infra/sharp/thumbnailGenerator.ts`

### TranscriptionServicePort

**Purpose:** Transcribe audio files

| Method                                 | Returns                             | Description         |
| -------------------------------------- | ----------------------------------- | ------------------- |
| `submitJob(userId, gcsPath, mimeType)` | `Promise<Result<{jobId}>>`          | Start transcription |
| `getJobStatus(jobId)`                  | `Promise<Result<TranscriptionJob>>` | Poll job status     |

**Implemented by:** `infra/speechmatics/transcriptionService.ts`

### LinkPreviewFetcherPort

**Purpose:** Fetch Open Graph metadata from URLs

| Method              | Returns                        | Description     |
| ------------------- | ------------------------------ | --------------- |
| `fetchPreview(url)` | `Promise<Result<LinkPreview>>` | Get OG metadata |

**Implemented by:** `infra/linkPreview/fetcher.ts`

### MessageSenderPort

**Purpose:** Send messages via WhatsApp

| Method                            | Returns                 | Description |
| --------------------------------- | ----------------------- | ----------- |
| `sendTextMessage(from, to, text)` | `Promise<Result<void>>` | Send text   |

**Implemented by:** `infra/whatsapp/messageSender.ts`

## Use Cases

### ProcessAudioMessageUseCase

**Purpose:** Handle incoming audio messages - download, store, save metadata

**File:** `domain/whatsapp/usecases/processAudioMessage.ts`

**Pattern:** Sync (returns result)

| Aspect           | Value                                                   |
| ---------------- | ------------------------------------------------------- |
| **Input**        | `ProcessAudioMessageInput`                              |
| **Output**       | `Result<{messageId, gcsPath, mimeType}, WhatsAppError>` |
| **Dependencies** | webhookEventRepo, messageRepo, mediaStorage, cloudApi   |
| **Invoked by**   | `webhookRoutes.ts` after message type detection         |

**Flow:**

1. Get media URL from WhatsApp API
2. Download audio binary
3. Upload to GCS
4. Save message to Firestore
5. Update webhook event status to `completed`

### ProcessImageMessageUseCase

**Purpose:** Handle incoming image messages - download, thumbnail, store, save

**File:** `domain/whatsapp/usecases/processImageMessage.ts`

**Pattern:** Sync (returns result)

| Aspect           | Value                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| **Input**        | `ProcessImageMessageInput`                                                |
| **Output**       | `Result<{messageId, gcsPath, thumbnailGcsPath}, WhatsAppError>`           |
| **Dependencies** | webhookEventRepo, messageRepo, mediaStorage, cloudApi, thumbnailGenerator |
| **Invoked by**   | `webhookRoutes.ts` after message type detection                           |

**Flow:**

1. Get media URL from WhatsApp API
2. Download image binary
3. Generate thumbnail
4. Upload original to GCS
5. Upload thumbnail to GCS
6. Save message to Firestore
7. Update webhook event status to `completed`

### TranscribeAudioUseCase

**Purpose:** Transcribe audio message via external service

**File:** `domain/whatsapp/usecases/transcribeAudio.ts`

**Pattern:** Fire-and-forget (void return)

| Aspect           | Value                                |
| ---------------- | ------------------------------------ |
| **Input**        | `TranscribeAudioInput`               |
| **Output**       | `void` (updates message directly)    |
| **Dependencies** | messageRepo, transcriptionService    |
| **Invoked by**   | Background after audio message saved |

**Flow:**

1. Update transcription state to `pending`
2. Submit job to Speechmatics
3. Poll until `done` or timeout
4. Update message with transcript or error

### ExtractLinkPreviewsUseCase

**Purpose:** Extract Open Graph metadata from URLs in message text

**File:** `domain/whatsapp/usecases/extractLinkPreviews.ts`

**Pattern:** Fire-and-forget (void return)

| Aspect           | Value                               |
| ---------------- | ----------------------------------- |
| **Input**        | `ExtractLinkPreviewsInput`          |
| **Output**       | `void` (updates message directly)   |
| **Dependencies** | messageRepo, linkPreviewFetcher     |
| **Invoked by**   | Background after text message saved |

**Flow:**

1. Extract URLs from text (max 3)
2. Update link preview state to `pending`
3. Fetch OG metadata for each URL in parallel
4. Update message with previews or error

## Utilities

| Utility                      | Purpose                                | File                   |
| ---------------------------- | -------------------------------------- | ---------------------- |
| `Logger`                     | Shared logging interface for use cases | `utils/logger.ts`      |
| `getExtensionFromMimeType()` | Map MIME type to file extension        | `utils/mimeType.ts`    |
| `normalizePhoneNumber()`     | Standardize phone number format        | `utils/phoneNumber.ts` |

## Dependency Graph

```
webhookRoutes.ts
  └── ProcessAudioMessageUseCase / ProcessImageMessageUseCase
        ├── WhatsAppCloudApiPort → cloudApiClient.ts
        ├── MediaStoragePort → mediaStorage.ts (GCS)
        ├── ThumbnailGeneratorPort → thumbnailGenerator.ts (Sharp)
        ├── WhatsAppMessageRepository → messageRepository.ts (Firestore)
        └── WhatsAppWebhookEventRepository → webhookEventRepository.ts

(Fire-and-forget after webhook response)
  ├── TranscribeAudioUseCase
  │     ├── TranscriptionServicePort → transcriptionService.ts (Speechmatics)
  │     └── WhatsAppMessageRepository
  └── ExtractLinkPreviewsUseCase
        ├── LinkPreviewFetcherPort → fetcher.ts
        └── WhatsAppMessageRepository
```

## Key Patterns

- **Fire-and-forget**: Audio transcription and link preview extraction run after the webhook returns 200, preventing timeouts
- **Result<T, E>**: All fallible operations return Result type, errors are explicit
- **Webhook event tracking**: Each webhook creates a tracking document to monitor processing status
- **Type aliases for DI**: `ProcessAudioMessageLogger = Logger` preserves specific naming for dependency injection
