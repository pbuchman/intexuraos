# Commands Agent

One place where every message enters the system — and gets understood.

## The Problem

You send yourself a message at 11 p.m. — a link, a half-formed idea, a task you need to handle tomorrow. By morning, it sits buried in a chat thread alongside grocery lists and group photos. You remember sending *something*. You cannot remember what.

The deeper problem is not forgetfulness. It is that capturing a thought and organizing it are two separate acts, and most tools force you to do both at once. You have to open the right app, pick the right category, fill in the right fields — and you have to do it in the moment, while the thought is still fresh. So you don't. You fire off a message and hope you will sort it out later. Later never comes.

The commands agent eliminates that second step entirely. Send a message — from WhatsApp, a voice note, or your phone's share menu — and the system figures out what you meant. A research question gets queued for research. A link gets saved as a bookmark. A task lands on your to-do list. No apps to open, no categories to pick, no forms to fill. Just say what you need, from wherever you are, and move on with your evening.

## Use Case: The Monday Morning Flood

You are an operator who spent the weekend collecting thoughts — some typed, some spoken, some shared from other apps.

1. Saturday afternoon, you tap "Share" on an article about competitor pricing from `https://research-tracker.io/pricing-analysis`. The system sees the share action, recognizes you did not ask it to investigate anything, and saves the link as a bookmark with a summary.
2. Saturday evening, you hold down the microphone and say: "Zbadaj jakie sa najnowsze trendy w logistyce ostatniej mili." You spoke in Polish, but the system does not translate and re-interpret — it understands the intent natively. "Zbadaj" means investigate. A research task is created.
3. Sunday morning, you type: "Create a todo to research competitor onboarding flows." The word "research" is right there in the sentence, but so is "create a todo." The system reads the explicit instruction first. A to-do item appears, not a research task.
4. Sunday night, you record a voice note rambling about a bug in the checkout flow. The transcription feeds through the same classification path as typed text. The system detects an engineering task and routes it to code.

By Monday, four different inputs — a shared link, a Polish voice command, an ambiguous typed message, and a rambling voice note — have each landed in the right place. You never opened a single organizing tool.

## How It Helps

### Understands What You Mean, Not What You Type

Most systems match keywords. If your message contains "research," it becomes a research task. If it contains "calendar," it goes to your calendar. This falls apart the moment real language enters the picture, because real language is full of words that mean different things depending on where they sit in a sentence.

The commands agent reads your messages through a five-step decision process that mirrors how a capable assistant would think. First, it checks whether you gave an explicit instruction — "create a todo," "add to calendar," "save this link." Explicit instructions always win, even when other words in the sentence point elsewhere. Only when no clear instruction exists does the system look at secondary signals: intent phrases, engineering task patterns, URL presence, and finally broader category patterns. The result lands in one of eight categories — to-do, research, note, link, calendar, project tracking, reminder, or code — each connected to a specialized agent that knows how to act on it.

**Example:** You type "create a todo to research competitors." A keyword matcher sees "research" and queues up an investigation. The commands agent sees "create a todo" — an explicit instruction — and adds the item to your task list. The word "research" describes what the task is about, not what you want the system to do.

### Speaks Your Language

The system does not translate your Polish into English and then try to interpret the translation. It recognizes intent phrases in both English and Polish as first-class inputs. "Investigate this" and "zbadaj to" carry the same weight. "Save a bookmark" and "zapisz zakladke" route to the same place. "Add to calendar" and "dodaj do kalendarza" trigger the same action.

This matters because translation introduces ambiguity. A phrase that is perfectly clear in Polish can become vague in English, and a system that relies on translation will misclassify the vague version. By understanding both languages natively, the commands agent preserves the clarity of your original words.

**Example:** You say "zbadaj jakie sa najnowsze trendy w e-commerce." The system recognizes "zbadaj" as an investigation intent and creates a research task — no intermediate translation step, no loss of meaning.

### Handles Every Input the Same Way

A typed message, a voice note, and a link shared from another app all follow the same classification path. Voice notes are transcribed, and the resulting text plus summary enter the same decision process as anything you type. Shared links from your phone's share menu get a confidence boost toward bookmark classification, since sharing a URL usually means you want to save it — but the system still checks whether you added instructions like "research this" before deciding.

This consistency means you never have to think about how to send something. The fastest way to capture a thought — whatever it happens to be in the moment — is the right way.

**Example:** You are walking and remember you need to look into a vendor contract. You record a voice note: "Look into the renewal terms for the Acme vendor contract before Thursday." The voice note gets transcribed and classified as a research task, just as if you had typed the same words.

### Gets Smarter Over Time

Every classification the system makes is stored alongside the confidence score, the reasoning behind the decision, and the version of the classification logic that produced it. This is not just record-keeping — it is the foundation for the system to learn from its own decisions.

This means you can inspect why any message was routed the way it was — the reasoning is right there, alongside the confidence level and the exact version of the logic that made the call. Today, the system applies a structured set of rules to classify your messages. Over time, the history of past classifications — which messages were ambiguous, which confident, which corrected — creates a dataset for refining those rules. The data to make this possible is already being collected with every message you send.

**Example:** You frequently send messages like "check on the Acme project status" — which could be a research task or a project tracking task. The system records each classification and its confidence. Over time, these records reveal that your "check on" messages about named projects consistently belong to project tracking, allowing future classification to become more precise.

### Recovers Without Asking You to Resend

If a message cannot be classified — because an API key is temporarily unavailable, for instance — it enters a pending state and retries automatically. You do not receive an error message. You do not need to send the message again. The system handles the interruption on its own and processes your message once the issue clears.

**Example:** You send a research request while a backend service is briefly unavailable. Instead of failing silently or asking you to try again, the system holds the message and retries until classification succeeds. Your research task appears in the queue without any action on your part.

## Getting Started

Send a message through WhatsApp, record a voice note, or use the share menu on your phone to push a link into the system. The commands agent picks it up, classifies it, and routes it — no setup, no configuration, no training required.

## Key Benefits

- **One front door** — every message enters through the same gateway, whether it comes from WhatsApp, a voice note, or the web app's share menu
- **Intent over keywords** — explicit instructions override misleading words, so "create a todo to research competitors" becomes a to-do, not a research task
- **Bilingual by design** — English and Polish intent phrases are understood natively, not translated, preserving the clarity of your original words
- **Eight categories, zero menus** — to-do, research, note, link, calendar, project tracking, reminder, and code tasks are all classified automatically
- **Automatic retry** — messages that cannot be classified immediately enter a pending state and retry without any action from you
- **Auditable decisions** — every classification is stored with confidence scores, reasoning, and logic version, so you can inspect why any message was routed the way it was

## Limitations

- **Two languages today** — native intent recognition covers English and Polish; other languages may work through general pattern matching but are not explicitly supported
- **Classification, not conversation** — the agent classifies individual messages into action types; it does not carry context across a multi-message thread
- **Confidence thresholds can surprise** — messages with ambiguous intent (confidence below 0.50) default to "note" rather than asking for clarification, which may not always match your expectation
- **No reclassification after the fact** — once a message is classified and an action is created, you can archive it but cannot re-route it to a different category
- **Share menu bias** — links shared through the phone's share intent receive a confidence boost toward bookmark classification, which is usually correct but may occasionally override a different intent

---

_Part of [IntexuraOS](../overview.md) — one front door for everything you need to say._
