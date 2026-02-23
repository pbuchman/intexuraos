# Notes Agent

Capture and organize text notes from any source -- save ideas, meeting summaries, and reference material without leaving your current workflow.

## The Problem

Information arrives from many directions: WhatsApp conversations, AI research results, action outputs, and manual entry. Without a unified note store, these insights scatter across systems and get lost. Users need a simple, centralized place to create, tag, and retrieve text notes regardless of which service produced them.

## How It Helps

### Instant Note Capture from Any Source

Create notes directly or let other IntexuraOS services create them on your behalf. Every note tracks which system created it and its original ID, so you always know the provenance.

**Example:** The research-agent completes a deep research query and saves the results as a note via the internal endpoint. The note appears in your dashboard tagged with "research" and linked back to the original query.

### Tag-Based Organization

Attach any number of tags to notes for flexible categorization. Group related notes across sources without rigid folder hierarchies.

**Example:** Tag meeting notes with "work" and "q1-planning", tag quick ideas with "idea" and "personal" -- then filter by tag to see everything related to a topic.

### Draft-to-Active Workflow

Internal services create notes as drafts when content is still being processed. Draft notes exist in storage but can be distinguished from finalized active notes.

**Example:** The actions-agent creates a draft note while processing a complex request. Once the action completes, the note remains with its draft status preserved as a record of the in-progress work.

## Use Case

You send a WhatsApp message: "Save a note about the deployment checklist for Friday." The commands-agent classifies this as a note creation request and routes it to the actions-agent, which calls the notes-agent internal endpoint. A note titled "Deployment checklist for Friday" appears in your dashboard tagged appropriately, with source tracking pointing back to the original WhatsApp message. Later, you open the web dashboard, find the note, and update it with the full checklist details using the PATCH endpoint.

## Key Benefits

- Zero-friction capture from any IntexuraOS service or the web dashboard
- Source tracking provides full provenance for every note
- Tag-based organization adapts to your workflow without rigid categories
- Clean REST API with full CRUD operations and OpenAPI documentation
- User-scoped access control ensures notes are private to their owner

## Limitations

- No rich text or markdown rendering -- notes store plain text content
- No note folders or hierarchies -- organization is tag-based only
- No full-text search across note content
- No sharing or collaboration between users
- No revision history or version tracking
- Status (draft/active) cannot be changed after creation via the public API
- Tag filtering not yet available on the list endpoint -- client-side filtering required
- No pagination on the list endpoint -- returns all user notes in a single response

---

_Part of [IntexuraOS](../overview.md) -- Capture your thoughts, wherever they strike._
