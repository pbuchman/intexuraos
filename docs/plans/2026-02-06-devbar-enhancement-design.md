# DevBar Enhancement Design

**Date:** 2026-02-06
**Status:** Approved

## Overview

Enhance the DevBar with tabbed interface containing:
1. **Commands** - Send command (moved to header) + results
2. **Pub/Sub** - Real-time Pub/Sub event viewer with topic filtering
3. **Logs** - Real-time PM2 log viewer with level/app filtering

## Design Decisions

| Decision              | Choice                  | Rationale                                 |
| --------------------- | ----------------------- | ----------------------------------------- |
| Layout                | Tabbed interface        | Maximum space per feature                 |
| Event/Log expansion   | Inline expansion        | View multiple items, natural flow         |
| Default state         | Collapsed items         | Less noise, expand on interest            |
| Topic filter default  | All topics visible      | Full visibility, filter to reduce         |

## Architecture

### Component Structure

```
DevBar.tsx (orchestrator)
├── DevBarHeader.tsx
│   ├── Environment badge
│   ├── Tab navigation
│   ├── Quick command input (inline in header)
│   └── Collapse button
├── DevBarCommandsTab.tsx
│   └── Command results history
├── DevBarPubSubTab.tsx
│   ├── TopicFilter.tsx
│   ├── EventList.tsx
│   └── EventItem.tsx (expandable)
└── DevBarLogsTab.tsx
    ├── LogFilter.tsx (level + app)
    ├── LogList.tsx
    └── LogItem.tsx (expandable)
```

### Shared Components

```
components/devbar/
├── ExpandableItem.tsx      - Shared expand/collapse logic
├── FilterBar.tsx           - Shared filter chip UI
└── ConnectionStatus.tsx    - SSE connection indicator
```

## UI Specifications

### Header (Always Visible)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● DEV MODE │ [Commands] [Pub/Sub] [Logs] │ [___command___][Send] │ LOCAL │ ▼ │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Command input in header saves vertical space
- Tabs switch content below
- Connection status indicators on Pub/Sub and Logs tabs

### Pub/Sub Tab

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Topics: [whatsapp-send ✓] [research-process ✓] [llm-call ✓] [+5 more] [Clear]│
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ 14:23:45 │ whatsapp-send │ msg_abc123 │ "Send reminder to..."          │
│ ▶ 14:23:44 │ llm-call      │ msg_def456 │ "Generate response..."          │
│ ▼ 14:23:43 │ research-proc │ msg_ghi789 │ "Process research..."           │
│   └─ { "query": "...", "sources": [...], "timestamp": "..." }              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Topic chips with checkboxes (all checked by default)
- Collapsed shows: time | topic | messageId | truncated data
- Expanded shows: formatted JSON with syntax highlighting

### Logs Tab

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Level: [error ✓] [warn ✓] [info ✓] [debug] │ App: [All ▾] │ [Clear] │ ● Live │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ 14:23:45 │ ERROR │ commands-agent │ Failed to parse command            │
│ ▶ 14:23:44 │ INFO  │ whatsapp-svc   │ Message sent successfully          │
│ ▼ 14:23:43 │ WARN  │ research-agent │ Rate limit approaching             │
│   └─ { "remaining": 5, "reset": "14:30:00", "endpoint": "/api/search" }    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Level filter chips (error, warn, info checked by default; debug unchecked)
- App dropdown for filtering by service
- Live indicator with connection status

### Commands Tab

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Recent command results:                                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ ✓ 14:23:45 │ Sent: "remind me to call mom tomorrow"                         │
│ ✗ 14:23:30 │ Failed: Connection timeout                                      │
│ ✓ 14:23:15 │ Sent: "what's on my calendar today"                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Simple list of command history
- Since command input is in header, this tab is just results

## Pub/Sub Topics (Default Visible)

All IntexuraOS topics visible by default:

| Topic                      | Description                    |
| -------------------------- | ------------------------------ |
| `whatsapp-send-message`    | Outgoing WhatsApp messages     |
| `research-process`         | Research agent processing      |
| `llm-call`                 | LLM API calls                  |
| `whatsapp-media-cleanup`   | Media file cleanup             |
| `commands-ingest`          | Command ingestion              |
| `whatsapp-webhook-process` | Webhook processing             |
| `whatsapp-transcription`   | Audio transcription            |
| `approval-reply`           | Approval workflow replies      |
| `calendar-preview`         | Calendar preview generation    |

## Environment Support

| Environment | Pub/Sub URL                       | Logs URL                          |
| ----------- | --------------------------------- | --------------------------------- |
| LOCAL       | `http://localhost:8105/events`    | `http://localhost:8106/logs`      |
| PRE-DEV     | `${origin}/devbar/events`         | `${origin}/devbar/logs`           |
| Production  | N/A (DevBar hidden)               | N/A (DevBar hidden)               |

## Implementation Plan

1. **Create shared components** (ExpandableItem, FilterBar, ConnectionStatus)
2. **Refactor DevBar** into header + tab container
3. **Move command input** to header
4. **Implement Pub/Sub tab** with topic filtering
5. **Implement Logs tab** with level/app filtering
6. **Add inline expansion** for both event types
7. **Test locally and on PRE-DEV**

## File Changes

### New Files
- `apps/web/src/components/devbar/ExpandableItem.tsx`
- `apps/web/src/components/devbar/FilterChip.tsx`
- `apps/web/src/components/devbar/ConnectionStatus.tsx`
- `apps/web/src/components/devbar/DevBarHeader.tsx`
- `apps/web/src/components/devbar/DevBarCommandsTab.tsx`
- `apps/web/src/components/devbar/DevBarPubSubTab.tsx`
- `apps/web/src/components/devbar/DevBarLogsTab.tsx`
- `apps/web/src/components/devbar/index.ts`

### Modified Files
- `apps/web/src/components/DevBar.tsx` - Refactor to use new components
