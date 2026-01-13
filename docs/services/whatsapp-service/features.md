# WhatsApp Service

WhatsApp integration for IntexuraOS - receive messages, handle media, and send notifications via WhatsApp Business API.

## The Problem

Users want to interact with IntexuraOS via WhatsApp:

1. **Message reception** - Receive text, images, and audio messages
2. **Media handling** - Download and store media files
3. **Audio transcription** - Convert voice messages to text
4. **User mapping** - Map phone numbers to user accounts
5. **Link previews** - Extract metadata from URLs in messages

## How It Helps

WhatsApp-service is the entry point for all WhatsApp interactions:

1. **Webhook validation** - HMAC-SHA256 signature verification
2. **Message storage** - Persist all messages with metadata
3. **Media download** - Fetch images/audio from WhatsApp
4. **Thumbnail generation** - Create 256px thumbnails for images
5. **Audio transcription** - Trigger async transcription via Pub/Sub
6. **Command routing** - Publish text messages to commands-agent
7. **Link preview** - Trigger OpenGraph extraction for URLs

## Use Cases

### Text message flow

1. User sends text to WhatsApp number
2. Webhook received, validated, persisted
3. Pub/Sub event published for async processing
4. Message saved to Firestore
5. `command.ingest` event published to commands-agent
6. `whatsapp.linkpreview.extract` event published if URLs detected
7. Confirmation message sent to user

### Image message flow

1. User sends image
2. Media downloaded from WhatsApp Cloud API
3. Uploaded to GCS
4. Thumbnail generated
5. Message saved with media paths
6. Confirmation message sent

### Audio message flow

1. User sends voice message
2. Media downloaded from WhatsApp Cloud API
3. Uploaded to GCS
4. Message saved with status=pending transcription
5. `whatsapp.audio.transcribe` event published
6. Transcription service processes audio
7. Message updated with transcription

## Key Benefits

**HMAC validation** - All webhooks signed with SHA-256 to prevent spoofing

**Async processing** - Pub/Sub ensures webhook response is fast

**Per-user phone numbers** - Each user maps to their own WhatsApp number

**Thumbnail generation** - Images resized to 256px for efficient loading

**Full media support** - Text, images, and audio messages

## Limitations

**WhatsApp Business required** - Requires WhatsApp Business API access

**Single direction** - Only receives messages; sends are via templates

**No video support** - Video messages are ignored

**File size limits** - Large media may fail to download

**Rate limits** - Subject to WhatsApp API rate limits

**No message editing** - Cannot edit sent messages
