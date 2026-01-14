# Todos Agent

Task management with support for todo items, priorities, due dates, and AI-powered item extraction from natural language.

## The Problem

Task management needs to be flexible:

1. **Quick capture** - Add tasks without complex forms
2. **Multiple items** - Break down tasks into sub-items
3. **Prioritization** - Mark urgent tasks
4. **Deadlines** - Track due dates

## How It Helps

Todos-agent provides comprehensive task management:

1. **AI item extraction** - Parse "Buy milk, eggs, and bread" into 3 items automatically
2. **Sub-items** - Create checklists within todos
3. **Priorities** - low, medium, high, urgent
4. **Due dates** - Track deadlines per todo or per item
5. **Reordering** - Arrange items in custom order

## Key Features

- **Status workflow**: draft → processing → pending → in_progress → completed → cancelled
- **Item status**: pending → completed
- **Archive management** - Soft delete with unarchive
- **AI-powered extraction** - Uses Gemini to parse items from natural language

## Limitations

- No recurring tasks
- No task dependencies
- No reminders/notifications
- No collaboration/sharing
- No subtasks beyond one level
