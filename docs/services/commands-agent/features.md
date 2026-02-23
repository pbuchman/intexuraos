# Commands Agent

One place where every message enters the system -- and gets understood.

## The Problem

You send yourself a message at 11 p.m. -- a link, a half-formed idea, a task you need to handle tomorrow. By morning, it sits buried in a chat thread alongside grocery lists and group photos. You remember sending *something*. You cannot remember what.

The deeper problem is not forgetfulness. It is that capturing a thought and organizing it are two separate acts, and most tools force you to do both at once. You have to open the right app, pick the right category, fill in the right fields. So you don't. You fire off a message and hope you will sort it out later.

The commands agent eliminates that second step. Send a message -- from WhatsApp, a voice note, or your phone's built-in sharing menu -- and the system figures out what you meant. A research question gets queued for research. A link gets saved as a bookmark. A task gets added to your to-do list. No menus, no dropdowns, no switching apps. Just say what you need and move on.

## Use Case: The Misleading Link

You are reading an article about AI research tools and tap "Share" from your browser. The URL happens to be `https://research-tracker.io/getting-started`. Without understanding your intent, a naive system would see the word "research" and queue up a research task -- wasting time and producing results you never asked for.

The commands agent treats the URL as a single unit. It ignores keywords buried inside web addresses and focuses on what you actually said around them. Since you shared the link without adding "research this" or "look into," the system recognizes you are saving a bookmark. The link lands in your bookmarks, summarized and ready to revisit -- not routed to a research workflow you never intended.

## How It Helps

### Intent Over Keywords

The system resolves ambiguity the way a careful reader would: explicit instructions first, context second, best guess last.

If you write "save bookmark https://research-world.com," the phrase "save bookmark" settles the matter before the system even considers the URL. If you prefix a message with `linear:` or say "create an issue," that explicit intent takes priority over everything else. Engineering-flavored language -- fix, implement, refactor -- routes to code tasks. A bare URL, with no instruction around it, defaults to a saved link. And when none of these signals are present, the system falls back to matching against category patterns like calendar dates, reminder phrases, or research questions.

The result: "create a todo to research competitors" becomes a to-do item, not a research project, because your explicit instruction ("create a todo") outranks the keyword "research."

### Language as Intent, Not Translation

The system understands commands in both English and Polish -- not through a translation layer, but natively. Polish phrases like "zbadaj" (investigate), "zapisz zakladke" (save bookmark), or "dodaj do kalendarza" (add to calendar) carry the same weight and trigger the same logic as their English equivalents. This is how you know the system reads *intent*, not just English keywords. Adding a third or fourth language means teaching the system new intent phrases, not rebuilding it.

### From Classification to Action

Understanding a message is only half the work. After the system determines what you want, it creates a corresponding action and notifies the rest of the platform to carry it out. A message classified as "research" creates a research action and signals the research agent to begin. A "calendar" classification triggers calendar event creation. The system recognizes eight distinct categories -- todo, research, note, link, calendar, reminder, linear (project tracking), and code (engineering tasks) -- and each one connects to a specialized part of the platform that knows how to handle it.

Voice notes follow the same path. The transcribed text arrives with a summary, and the classification treats it identically to a typed message. Whether you type, speak, or share, the result is the same.

### Built for Future Intelligence

Every classification is stored with the system's confidence in its decision, the reasoning behind it, and the exact version of the logic that produced it. Over time, this creates a detailed record of how the system performs -- which kinds of messages it handles confidently, which ones fall into grey areas, and how updates to the classification logic affect accuracy.

This record is what makes the system improvable. Because every decision is logged with its context, future versions can learn from real patterns in real usage rather than starting from scratch. And because understanding a message is separated from acting on it, adding new categories, new input sources, or new intelligence does not require rewriting what already works.

### Quiet Resilience

If the system temporarily cannot classify a message -- for example, when a required language model is unavailable -- the message enters a holding state and is automatically retried every five minutes. You never need to resend it. Once classification succeeds, the message moves through the same path as any other, with no gap in your records.

## Key Benefits

- Send from WhatsApp text, voice notes, or the share menu on your phone -- every channel is treated equally
- Explicit instructions ("save bookmark," "create todo," "zbadaj") always override ambiguous signals
- URLs inside messages never trigger false classifications from embedded keywords
- Eight categories cover the full range from quick notes to engineering tasks to project tracking
- Every decision is recorded with its reasoning, so the system can learn and improve over time
- Messages that cannot be classified immediately are held and retried automatically

## Limitations

- **Language model required** -- Classification depends on access to a language model. Without a configured key, messages queue as pending until one becomes available.
- **Reminder and code handlers** -- The system classifies reminders and code tasks, but the agents that execute those actions are still under development.
- **Language coverage** -- English and Polish are natively supported. Other languages fall back to English-based pattern matching.
- **Ambiguous messages** -- When the system is not sure enough what you meant, it saves the message as a note rather than guessing wrong.
- **No user reclassification** -- Once classified, a command cannot be manually recategorized. Commands that have not yet been classified can be deleted and resent.

---

_Part of [IntexuraOS](../overview.md) -- one front door for everything you need to say._
