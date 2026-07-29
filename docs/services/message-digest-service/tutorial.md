# Message Digest Service — Tutorial

This tutorial creates a WhatsApp digest through the web UI, verifies its schedule and prompt, runs a safe preview, and checks the first delivered result.

## Prerequisites

- Sign in to IntexuraOS with the account that owns the WhatsApp connection.
- Confirm at least one WhatsApp phone is connected to that account.
- Allow the private WhatsApp mirror to finish synchronizing the target conversation.

No destination number is configured in the digest editor. Delivery always uses the user's first mapped WhatsApp phone.

## 1. Open Message Digests

1. In the left navigation, open **WhatsApp**.
2. Select **Message Digests**.
3. Confirm the readiness panel says WhatsApp delivery is available.
4. Select **New digest**.

The direct route is `/whatsapp/message-digests`.

## 2. Choose the source

Choose either **Group** or **Direct chat**, then select one conversation from the account-scoped picker.

- For a group, use the **Fishing group** template when you want key topics, decisions, moderator information, and open threads.
- For a direct chat, use the **Sentiment and follow-up** template when you want the other participant's tone, commitments, unresolved questions, and follow-ups.

The selected chat is frozen to its current private source generation and revision. If WhatsApp reconnects or the source identity changes, the definition will require explicit repair instead of reading a different chat.

## 3. Configure the schedule

Select one cadence:

- **Daily** — every calendar day;
- **Weekdays** — Monday through Friday;
- **Weekly** — one selected weekday.

Choose the local time and time zone. Review the schedule preview before continuing; it shows the next boundary in both local time and UTC and accounts for daylight-saving changes.

## 4. Write the instructions

Start from a template, then make the instruction concrete. A useful direct-chat prompt is:

> Summarize the other person's sentiment, decisions, promises, deadlines, unresolved questions, and anything I should follow up on. Distinguish facts from your interpretation.

Avoid asking the model to infer protected or sensitive traits. The source window already identifies the conversation, so phone numbers and internal chat identifiers do not belong in the prompt.

## 5. Preview before saving

Select **Preview**. The preview reads the bounded source window and generates a summary, but it does not persist a run and cannot send a WhatsApp message.

Check:

- the selected group or contact is correct;
- the source time window is expected;
- message count is plausible;
- the summary follows the instructions;
- no unrelated conversation appears.

Adjust the prompt and preview again if needed.

## 6. Save and run

Select **Create digest**. On the detail page, verify the source, cadence, next run, prompt, and delivery path.

To test immediately:

1. Select **Run now**.
2. Confirm the frozen time window.
3. Queue the run.
4. Follow its progress on the detail page or in **History**.

A window without messages ends as **No activity** and does not send. A completed run should progress from summary complete to WhatsApp delivery sent.

## 7. Verify in WhatsApp

Open the already connected WhatsApp account. The message arrives at the first mapped number using the approved digest template. Open its action link and confirm it returns to the exact run detail page.

If delivery readiness fails, repair the account's WhatsApp mapping rather than adding a destination to the digest.

## 8. Operate the definition

- **Pause** stops new scheduled reservations without deleting history.
- **Resume** calculates the next future schedule boundary.
- **Edit** changes cadence or instructions through a new definition revision.
- **Retry** is available only for an eligible failed run.
- **Delete** disables new work immediately and starts physical erasure.

Never retry an ambiguous provider result manually. The service reconciles the provider outcome before another send is allowed.

## API discovery

Developers can inspect the same contract at `/api/message-digests/docs` or `/api/message-digests/openapi.json`. See the [technical reference](technical.md) for route and state details.
