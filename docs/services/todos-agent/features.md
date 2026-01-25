# Todos Agent

Task management with support for todo items, priorities, due dates, and AI-powered item extraction from natural language.

## The Problem

Task management needs flexibility and automation:

1. **Quick capture** - Add tasks without navigating complex forms
2. **Break down complexity** - Split large tasks into actionable sub-items
3. **Prioritize effectively** - Mark urgent tasks and track deadlines
4. **Automate organization** - Let AI parse natural language into structured items

## How It Helps

### AI Item Extraction

Send a description, get structured items. The service uses your configured LLM to parse natural language into todo items with titles, priorities, and due dates.

**Example:** Send "Buy milk, eggs, and bread from grocery store by Friday" — the service extracts three items: "Buy milk", "Buy eggs", "Buy bread", each with appropriate priority and the Friday due date.

### Sub-items with Custom Ordering

Break down large tasks into checklists. Drag and drop items to arrange them in your preferred order.

**Example:** A "Q4 Planning" todo contains items: "Review Q3 results", "Set Q4 objectives", "Schedule team meetings" — reorder them as priorities change.

### Priority Levels

Four priority levels help you focus on what matters: low, medium, high, urgent. Each todo and item can have its own priority.

**Example:** "Finish quarterly report" gets high priority, while "Organize desk" gets low priority.

### Status Workflow

Track todos through a complete lifecycle: draft → processing → pending → in_progress → completed (or cancelled). Archive completed todos to clear your active view without losing history.

## Use Case

You're driving when you remember your weekly tasks. You send one message: "Plan week: finish sales presentation by Wednesday, call dentist, review team updates on Friday."

The service creates one todo with three items. Each item gets a due date. The presentation item gets high priority. When you open your dashboard, everything is organized and actionable.

## Key Benefits

- Zero-friction task capture from anywhere (via WhatsApp or web)
- AI automatically structures free-form text into actionable items
- Flexible priority levels match your workflow
- Archive keeps history without cluttering active views
- Item reordering adapts to changing priorities

## Limitations

- No recurring tasks (must recreate manually)
- No task dependencies (items are independent)
- No reminders or notifications
- No collaboration or sharing features
- One level of sub-items only (no nested subtasks)

---

_Part of [IntexuraOS](../overview.md) — Task management that thinks with you._
