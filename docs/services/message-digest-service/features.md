# Message Digest Service

Message Digest Service turns private WhatsApp conversations into scheduled summaries. A user can create one digest for a group or a direct chat, choose when it runs, and provide the instructions used to create the summary.

## User experience

The Message Digests page lives under WhatsApp in the web application. From one place a user can:

- create a digest from an available WhatsApp group or direct chat;
- choose daily, weekdays, or weekly delivery at a local time and IANA time zone;
- start from the Fishing group, direct-contact sentiment, or custom instruction template;
- preview the source window and generated summary before saving;
- pause, resume, edit, run now, retry, or delete a definition;
- inspect run history, source counts, processing state, and WhatsApp delivery state.

The editor explains the next scheduled run and warns when the connected WhatsApp account is not ready to receive a digest. Unsaved changes are protected on in-app navigation and browser exit.

## Group and direct-chat summaries

A group digest can capture decisions, important announcements, open threads, and recurring participants. The migrated Fishing group definition preserves the prior summary continuity while reading canonical private WhatsApp messages instead of mobile notifications.

A direct-chat digest can use instructions such as:

> Summarize the other participant's sentiment, important commitments, unresolved questions, and anything I should follow up on.

Only the selected conversation is read. The definition is bound to the user's private WhatsApp source account, chat identity, source generation, and revision so that reconnects or source changes cannot silently broaden access.

## Delivery

Completed summaries are sent by WhatsApp Service to the user's first mapped phone number. There is no separate destination setting in Message Digests. If the user has no deliverable WhatsApp mapping, the UI shows the readiness problem and no send is attempted.

Delivery uses the approved Polish `intexuraos_message_digest_v4` WhatsApp template. It presents the source window, headline, and up to three importance-ordered sections before linking back to the exact run in the web application. The template owns the visual line breaks while runtime section parameters stay single-line for Meta compatibility. Retries are idempotent and ambiguous provider outcomes are reconciled before another send can occur.

## Reliability and privacy

- Scheduler ticks run every five minutes and reserve each due window exactly once.
- Source messages are bounded to 5,000 messages and 2 MB per run.
- Empty windows become `skipped_no_activity` runs and do not send a message.
- Processing leases and heartbeats allow safe recovery after worker interruption.
- Delivery authorization prevents stale or deleted definitions from sending.
- Deleting a digest starts a generation-fenced physical erasure workflow.
- Logs and migration reports contain metadata only, never prompt text, summaries, phone numbers, or source message bodies.

## Ownership boundaries

Message Digest Service owns definitions, schedules, prompts, summary generation, run history, retries, and migration continuity. WhatsApp Service owns private message access, delivery readiness, destination selection, and provider delivery. Mobile Notifications Service only captures Android notifications and has no digest responsibility.

## Related documentation

- [Technical reference](technical.md)
- [Tutorial](tutorial.md)
- [Agent interface](agent.md)
- [Technical debt](technical-debt.md)
- [Production migration and cutover runbook](../../runbooks/whatsapp-message-digests.md)
