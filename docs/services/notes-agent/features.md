# Notes Agent

Your notes, in one place. A native home for quick thoughts, captured ideas, and anything worth remembering -- ready for the day they connect to your external notes system too.

## The Problem

Good ideas are scattered. A thought captured during a WhatsApp conversation lives in WhatsApp. A note jotted during a research session lives in your head. An insight surfaced by an agent disappears the moment you scroll past it. There is no single, lightweight place inside the platform to hold these fragments -- and no way for agents to store a note on your behalf without building their own storage.

## Use Case: Capture Without Friction

Built for anyone who needs to write something down without deciding where it goes.

You are reviewing a research report when a follow-up question comes to mind. Instead of opening a separate app, you create a note directly in IntexuraOS, tag it with the project name, and move on. Later that afternoon, the actions-agent processes a voice command you sent via WhatsApp -- "save a note about the quarterly budget review" -- and a note appears in your list, tagged and timestamped, without you lifting a finger.

At the end of the week, you open your notes, scan the most recently updated ones at the top, and decide which thoughts deserve action and which can wait.

## How It Helps

### A Native Note Store

Notes-agent provides a simple, tag-organized home for text notes inside IntexuraOS. Create a note with a title, body, and any number of tags. Retrieve your full list -- sorted by most recently updated -- or pull up a specific note by ID. Edit the title, content, or tags whenever you need to. Delete what you no longer want.

There is no formatting engine, no folder hierarchy, no collaboration layer. That is by design. This is a capture surface, not a document editor. The goal is speed: get the thought down, tag it, come back later.

### Cross-Agent Note Creation

Other agents in the system can create notes on your behalf through an internal endpoint. When the actions-agent processes a voice command that should become a note, or when another service needs to preserve a piece of information for you, the note appears in your list automatically -- same tags, same structure, same place. You do not need to know which agent created it. It just shows up.

## Key Benefits

- **Tag-based organization** -- Attach any tags to notes for lightweight grouping and retrieval
- **Capture from anywhere** -- Create notes from the web dashboard, or let agents create them from WhatsApp and other channels
- **Most-recent-first** -- Notes sorted by last update, so recent thoughts surface naturally
- **Future integration point** -- A native store today, a bridge to external notes systems tomorrow

## Limitations

- **Plain text only** -- No rich text, markdown rendering, or formatting
- **No folders or hierarchies** -- Organization is flat, tag-based only
- **No full-text search** -- Browsing by recency or retrieving by ID; no keyword search across note content
- **No sharing or collaboration** -- Notes are private to each user
- **No revision history** -- Edits overwrite the previous version
- **No tag filtering on list** -- Listing returns all notes; filtering by tag must be done client-side

---

_Part of [IntexuraOS](../overview.md) -- Your notes, captured and organized in one place._
