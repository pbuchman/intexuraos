# Intex Chat Agent

An in-app AI assistant that answers questions about IntexuraOS, explains APIs, and creates commands on your behalf -- all through natural conversation.

## The Problem

Users need fast, contextual help while working inside IntexuraOS. Switching between documentation tabs, searching API specs, and copying endpoint details interrupts their flow and slows down adoption.

## How It Helps

### Documentation Q&A with Source Citations

Ask a question in plain language and get an accurate answer drawn directly from IntexuraOS docs. Every response includes clickable source references so you can verify and dig deeper.

**Example:** Ask "How do I create a todo with a due date?" and the assistant responds with the exact endpoint, required fields, and a code snippet -- with a link to the todos-agent API reference.

### Command Creation Through Conversation

Tell the assistant what you want to do, and it proposes the command for you. Confirm with a single "yes" and the command is created -- no forms, no field hunting.

**Example:** Say "Create a todo to review the Q1 budget by Friday." The assistant extracts the task, suggests the command, and waits for your confirmation before creating it.

### Guest Access Without Sign-Up

Visitors can try the assistant without creating an account. Guest sessions use a platform-provided LLM model (GLM-4.7-Flash) at zero cost, with rate limiting to prevent abuse.

**Example:** A prospective user lands on the marketing page, opens the chat widget, and asks "What can IntexuraOS do?" -- no login required, instant response.

### Conversation Context

The assistant remembers the current conversation thread, so follow-up questions work naturally. Ask about a topic, then refine your question without repeating context.

**Example:** Ask "How does the bookmarks agent work?" followed by "What about its tags feature?" -- the assistant understands you are still talking about bookmarks.

### Multilingual Confirmation

Confirm command creation in English or Polish. The assistant recognizes affirmative phrases in both languages: "yes", "sure", "tak", "jasne", and more.

## Use Case

You are building an integration with IntexuraOS and need to send a WhatsApp message through the API. You open the chat widget and ask "How do I send a WhatsApp message?" The assistant pulls relevant documentation about the whatsapp-service endpoints, explains the required headers and payload, and cites the exact API reference.

Then you say "Create a todo to implement the WhatsApp integration by next Monday." The assistant proposes the command with the text and due date. You say "yes" and the todo appears in your task list.

## Key Benefits

- Instant answers from platform documentation without leaving your workflow
- Command creation through natural language saves time on repetitive form-filling
- Source citations build trust and enable deeper exploration
- Guest access lowers the barrier for new users to explore the platform
- Conversation history preserves context across follow-up questions

## Limitations

- Can only create commands (cannot edit or delete existing ones)
- Cannot access user data directly -- only references public documentation
- Documentation answers depend on indexed content; newly added docs require re-indexing
- Guest sessions are rate-limited to 100 messages per hour per session
- If the assistant cannot find relevant documentation, it provides general guidance with a disclaimer

_Part of [IntexuraOS](../../overview.md)_
