# IntexuraOS

Autonomous AI agent platform for capturing, organizing, and acting on information across multiple sources.

## The Problem

Managing information across WhatsApp, web links, notes, tasks, and research queries is fragmented. Users switch between
apps, lose context, and manually re-enter data.

## How IntexuraOS Helps

IntexuraOS provides a unified platform with:

1. **Capture** - Ingest from WhatsApp, shared links, voice, and web
2. **Organize** - Automatic classification into actions, research, notes, bookmarks, todos
3. **Act** - Multi-LLM research, task management, calendar integration
4. **Integrate** - Connect with Notion, Google Calendar, WhatsApp

## Core Services

### Action Orchestration

**[actions-agent](services/actions-agent/features.md)** - Central action lifecycle management

- Unified queue for todos, research, notes, links
- Status tracking and Pub/Sub distribution
- Agent coordination

### AI & Research

**[research-agent](services/research-agent/features.md)** - Multi-LLM research synthesis

- Parallel queries across Claude, GPT-5, Gemini, Perplexity
- Public sharing via GCS-hosted reports
- Cover image generation

**[commands-agent](services/commands-agent/features.md)** - Command classification

- Understands user intent from natural language
- Routes to appropriate action type
- Model preference detection

**[data-insights-agent](services/data-insights-agent/features.md)** - Data analysis

- Upload custom datasets
- AI-generated insights and charts
- Composite data feeds

### Content Management

**[bookmarks-agent](services/bookmarks-agent/features.md)** - Link saving

- OpenGraph metadata extraction
- AI summaries
- Tag-based filtering

**[todos-agent](services/todos-agent/features.md)** - Task management

- AI item extraction from natural language
- Priorities and due dates
- Sub-items with ordering

**[notes-agent](services/notes-agent/features.md)** - Note-taking

- Simple CRUD interface
- Tag support
- Draft/active states

**[promptvault-service](services/promptvault-service/features.md)** - Prompt templates

- Notion database sync
- Version tracking

### Integrations

**[user-service](services/user-service/features.md)** - Authentication & settings

- Auth0 device code flow
- API key management with AES-256-GCM encryption
- Google OAuth token refresh

**[whatsapp-service](services/whatsapp-service/features.md)** - WhatsApp Business

- Message ingestion via webhooks
- Media download and GCS storage
- Audio transcription trigger

**[calendar-agent](services/calendar-agent/features.md)** - Google Calendar

- Event CRUD operations
- Free/busy queries
- Multi-calendar support

**[notion-service](services/notion-service/features.md)** - Notion integration

- Token validation and storage
- Connection status monitoring

### Infrastructure

**[web-agent](services/web-agent/features.md)** - Web scraping

- OpenGraph metadata extraction
- Batch URL processing
- 2MB size limit

**[image-service](services/image-service/features.md)** - Image generation

- DALL-E 3 and Imagen 3
- GCS storage with thumbnails

**[mobile-notifications-service](services/mobile-notifications-service/features.md)** - Push notifications

- Signature-based device authentication
- Notification filtering

**[api-docs-hub](services/api-docs-hub/features.md)** - API documentation

- Unified Swagger UI
- Multi-spec aggregation

**[app-settings-service](services/app-settings-service/features.md)** - Configuration

- LLM pricing for all providers
- Usage cost analytics

## Service Architecture

```
User Input
    |
    v
[commands-agent] --classify--> [actions-agent]
|  |  |
|  |
|  |  |
    v                               v                      v
[research-agent]              [todos-agent]          [bookmarks-agent]
|  |  |
|  |
|  |
                        v                                  v
                [image-service]                      [web-agent]
                        |
                        v
                [user-service] --keys--> [All LLM Services]
                        |
                        v
                [calendar-agent]
                        |
                        v
                [whatsapp-service] --notifications--> [mobile-notifications-service]
```

## Data Flow

1. **Ingestion** - WhatsApp messages, shared links, voice transcriptions
2. **Classification** - commands-agent categorizes intent
3. **Routing** - actions-agent creates appropriate action
4. **Processing** - Specialized agents execute actions
5. **Notification** - Results pushed via mobile-notifications-service

## Services Summary

| Service                      | Purpose                | Category       |
| ---------------------------- | ---------------------- | -------------- |
| actions-agent                | Action orchestration   | Infrastructure |
| research-agent               | Multi-LLM research     | AI & Research  |
| user-service                 | Auth & settings        | Integrations   |
| image-service                | Image generation       | Infrastructure |
| bookmarks-agent              | Link management        | Content        |
| notes-agent                  | Note-taking            | Content        |
| todos-agent                  | Task management        | Content        |
| whatsapp-service             | WhatsApp integration   | Integrations   |
| commands-agent               | Command classification | AI & Research  |
| web-agent                    | Web scraping           | Infrastructure |
| calendar-agent               | Google Calendar        | Integrations   |
| data-insights-agent          | Data analysis          | AI & Research  |
| mobile-notifications-service | Push notifications     | Infrastructure |
| api-docs-hub                 | API documentation      | Infrastructure |
| app-settings-service         | App configuration      | Infrastructure |
| notion-service               | Notion integration     | Integrations   |
| promptvault-service          | Prompt templates       | Content        |

## Documentation

Complete documentation for all services is available in [services/](services/).

**Last updated:** 2026-01-13
