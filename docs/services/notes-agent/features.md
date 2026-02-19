# Notes Agent

Simple note-taking service for IntexuraOS. Create, view, update, and delete text notes with tags and source tracking.

## The Problem

Users need a quick way to capture information from multiple systems:

1. **Quick capture** - Save thoughts without complex formatting requirements
2. **Organization** - Tag-based categorization for later retrieval
3. **Source tracking** - Know which system or agent created each note

## How It Helps

Notes-agent gives you a minimal but functional note store:

- Create notes with title, content, and tags
- List all your notes
- Read, update, or delete individual notes
- Track the source system that created each note (WhatsApp, actions-agent, web, etc.)

## Key Features

- **Tag-based organization** - Attach any tags to notes for grouping
- **Source tracking** - Every note records which system created it and its ID in that system
- **Internal creation** - Other IntexuraOS services create notes on behalf of users via the internal endpoint
- **Draft status** - Notes can be created as drafts via the internal endpoint before going active
- **Observability** - Full Sentry error tracking and Dash0 OpenTelemetry tracing

## Limitations

- No rich text or markdown formatting
- No note folders or hierarchies
- No full-text search
- No sharing or collaboration
- No revision history
- Status cannot be changed after creation (PATCH only supports title, content, tags)
- Tag filtering not yet available on the list endpoint (client-side filtering required)
