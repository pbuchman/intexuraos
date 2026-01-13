# Commands Agent

Intelligent command classification system - understand user intent and route to the appropriate action handler.

## The Problem

Users send natural language requests through multiple channels:

1. **Ambiguous intent** - "Remember this" could be a note, todo, or bookmark
2. **Multiple channels** - WhatsApp, voice transcriptions, web app sharing
3. **Manual routing** - Users must select the correct action type
4. **No deduplication** - Same request processed multiple times

## How It Helps

Commands-agent is the intelligent entry point for all user commands:

1. **AI classification** - Uses Gemini 2.5 Flash to categorize commands into 6 action types
2. **Idempotency** - Deduplicates based on sourceType + externalId (e.g., WhatsApp message ID)
3. **Model selection** - Detects LLM preferences from command text ("use Claude", "all models")
4. **Graceful degradation** - Marks as pending_classification when API keys unavailable
5. **Scheduled retries** - Cloud Scheduler processes pending commands

## Key Features

**Classification Types:**

- `todo` - Task management
- `research` - Multi-LLM research queries
- `note` - Note-taking
- `link` - Bookmark/URL saving
- `calendar` - Calendar events (future)
- `reminder` - Reminders (future)
- `unclassified` - No actionable intent detected

**Source Types:**

- `whatsapp_text` - Text messages from WhatsApp
- `whatsapp_voice` - Transcribed voice messages
- `pwa-shared` - Web app share sheet

**Idempotency:** Commands identified by `{sourceType}:{externalId}`. Duplicate ingestion returns existing command.

**Model Detection:** Extracts user preferences like "use Claude" or "all models" for research queries.

## Use Cases

### WhatsApp message flow

1. User sends "Research AI safety trends" to WhatsApp
2. whatsapp-service publishes `command.ingest` event
3. commands-agent receives via Pub/Sub push
4. Gemini classifies as `research` with 0.92 confidence
5. Creates action via actions-agent
6. Publishes `action.created` event
7. research-agent processes the research query

### Web app sharing flow

1. User shares URL/text via PWA share sheet
2. Frontend POSTs to `/commands` with source=`pwa-shared`
3. Classified synchronously
4. Returns command with actionId

### Pending classification retry

1. User sends command before configuring API keys
2. Command marked `pending_classification`
3. Cloud Scheduler calls `/internal/retry-pending` every 5 minutes
4. Pending commands reprocessed with available keys

## Key Benefits

**Intent understanding** - No manual action type selection required

**Channel flexibility** - WhatsApp, voice, web all use same pipeline

**Model preference detection** - "Use Sonar for this" automatically configures research

**Graceful degradation** - Commands queued when API unavailable

**Audit trail** - Every command with classification, confidence, reasoning preserved

## Limitations

**Gemini dependency** - Classification requires Google API key configured

**Action handlers required** - calendar and reminder handlers not yet implemented

**English optimization** - Classifier prompt optimized for English commands

**Confidence threshold** - Low confidence commands marked unclassified

**No reclassification** - Failed commands must be retried, not reclassified
