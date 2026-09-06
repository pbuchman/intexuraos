# Intex Agent Dev API Conversation Test Scenarios

## Purpose

These scenarios define behavioral checks for `intex-agent` in local/dev. They can run through the internal mocked-tool endpoint for conversation behavior or through the full dev flow for downstream resource persistence.

The testing agent must drive the system through APIs and verify the user-facing behavior, session lifecycle, timeline events, and resource intent. The validation must not be a raw JSON snapshot comparison. JSON from APIs is evidence, but the contract is what happens when the user types, what the assistant replies, what session state is produced, and whether the expected tool/resource effect is represented.

## Execution Modes

`internal_mock_tools`: use `POST /internal/intex-agent/test/conversation` on local or dev host-local `intex-agent` with `X-Internal-Auth`. Set `mode: "live_llm_mock_tools"`, use a unique lowercase `runId`, and set `userId` to `test-intex-agent-<runId>`. This mode preserves session lifecycle, prompt preferences, classifier, runner, confirmations, fallback handling, and `handleIncomingMessage()`, but all tools are mocked. It verifies intended tool execution and assistant behavior, not downstream provider persistence.

`full_dev_flow`: use the deployed dev WhatsApp ingress path and connected test account. This mode verifies provider resources such as created notes or calendar events.

Current Intex Agent sessions remain `waiting_for_user` after completed, clarification, no-action, and unsupported outcomes. Treat completed/unsupported timeline events and user-facing replies as the outcome evidence; do not require session close events unless the scenario explicitly supersedes or expires a session.

## Test Harness Expectations

Use a dedicated dev test user with:

- WhatsApp Assistant mapping enabled.
- Google Calendar connected.
- Notes available.
- A deterministic timezone known to the test harness.

Every user message should include a unique marker such as `INTEX-E2E-<timestamp>-<scenario>` so the testing agent can find related sessions, notes, and calendar events without relying on global ordering.

The testing agent should use API calls against the selected execution mode to:

- In `internal_mock_tools`, submit the complete conversation to
  `POST /internal/intex-agent/test/conversation`.
- In `internal_mock_tools`, read assistant replies from
  `data.turns[].assistantReplies`, not from WhatsApp-facing outbound resources.
- In `internal_mock_tools`, inspect `data.sessions`, `data.sessionTransitions`,
  sanitized `data.eventsBySessionId`, `data.toolCalls`, and
  `data.behavioralTranscript` from the response.
- In `full_dev_flow`, submit inbound WhatsApp Assistant messages to the deployed
  dev flow.
- In `full_dev_flow`, read assistant replies through the dev-visible outbound
  message/session APIs.
- In `full_dev_flow`, read `intex-agent` sessions and session timeline events.
- In `internal_mock_tools`, verify `toolCalls`, `behavioralTranscript`, and sanitized `eventsBySessionId`.
- In `full_dev_flow`, verify created notes through notes APIs or the web-visible note read path.
- In `full_dev_flow`, verify created calendar events through calendar APIs or Google Calendar-visible event read paths.

Exact assistant wording may vary, but the reply must contain the required meaning. Session boundary phrases are required: the user must be told when a new session starts and when the previous session was closed, finished, expired, or superseded.

## Dev API Execution Contract

Each scenario is a conversation contract, not a response-body contract. The testing agent may use JSON APIs to drive and observe the system, but validation must be phrased around what the user experienced and what persisted state proves happened.

For each scenario:

1. Generate a marker in the form `INTEX-E2E-<runId>-<scenarioNumber>`.
2. In `internal_mock_tools`, send one request containing the scenario `turns`,
   `runId`, `userId: test-intex-agent-<runId>`, `currentDateTime`, and bounded
   `toolMocks`. Treat the captured assistant replies in the response as the
   user-visible replies for this mode.
3. In `full_dev_flow`, send each "User types" message through the dev WhatsApp
   Assistant ingress. If the harness exercises the full WhatsApp adapter, submit
   the message through the WhatsApp webhook simulation path.
4. In `full_dev_flow`, use the same dev user, WhatsApp sender, and channel
   identity for every turn in the same scenario.
5. In `full_dev_flow`, poll assistant replies until a WhatsApp-facing assistant
   message is available for the turn.
6. Locate the session by user, marker, and recent timeline content. In
   `internal_mock_tools`, use the response's `sessions` and `eventsBySessionId`;
   in `full_dev_flow`, list recent sessions for the user and inspect timeline
   events until the marker is found.
7. Verify the session state and timeline events described by the scenario.
8. In `internal_mock_tools`, verify the expected mocked tool call and result summary.
9. In `full_dev_flow`, verify the resulting note or calendar event through the relevant dev API or connected provider read path.
10. For negative scenarios, verify that no mocked tool call happened in `internal_mock_tools` and that no note or calendar event containing the marker was created in `full_dev_flow`.

The testing agent should report results as a behavioral transcript:

- The user message that was submitted.
- The assistant message the user would see.
- The session that was opened, continued, closed, or superseded.
- The tool call that did or did not happen.
- The resource that was created or intentionally not created.

The testing agent must not pass a scenario by comparing raw JSON to an expected JSON object. JSON fields are supporting evidence only.

## Scenario 1: Create A Note In One Message

User types:

```text
Remember that the garage code for INTEX-E2E-001 is 7241.
```

Expected assistant behavior:

- Replies in WhatsApp.
- Says that a new session started.
- Confirms the note was saved.
- Does not ask a clarification.
- Does not mention unsupported capabilities.

Expected session state:

- One new session exists for the test user.
- Session starts with `startReason: no_active_session` unless a prior session exists, in which case the assistant must acknowledge the prior session before starting this one.
- Session status remains `waiting_for_user` after the assistant reply; completion is proven by the completed tool event and reply.
- Active or completed tool is `create_note`.
- Timeline includes session start, user message, note tool completion, and assistant confirmation.

Expected resource result:

- A note exists with the marker `INTEX-E2E-001`.
- The note content preserves the garage code `7241`.

## Scenario 2: Create A Calendar Event In One Message

User types:

```text
Create a calendar event for INTEX-E2E-002 dentist appointment on August 18 2026 at 2:30 PM for 45 minutes at Smile Clinic.
```

Expected assistant behavior:

- Replies in WhatsApp.
- Says that a new session started.
- Confirms the calendar event was created.
- Includes enough human-readable event details to recognize the title, date, and time.
- Does not ask a clarification.

Expected session state:

- Session status remains `waiting_for_user` after the assistant reply; completion is proven by the completed tool event and reply.
- Active or completed tool is `create_calendar_event`.
- Timeline includes session start, user message, calendar tool completion, and assistant confirmation.

Expected resource result:

- A calendar event exists with title or description containing `INTEX-E2E-002`.
- The event starts on August 18, 2026 at 2:30 PM in the test user's timezone.
- The event duration is 45 minutes.
- The location is `Smile Clinic`.

## Scenario 3: Calendar Event Missing Date Requires Clarification

User first types:

```text
Add INTEX-E2E-003 lunch with Marta at noon.
```

Expected assistant behavior after first message:

- Replies in WhatsApp.
- Says that a new session started.
- Asks which day or date the lunch should be scheduled for.
- Does not create a calendar event yet.

Expected session state after first message:

- Session status is `waiting_for_user`.
- Active tool is `create_calendar_event` or the timeline clearly records a pending calendar event intent.
- Timeline includes session start, user message, assistant clarification, and a clarification-requested event.

User then types:

```text
Next Tuesday.
```

Expected assistant behavior after second message:

- Continues the same session.
- Does not say that a new session started.
- Confirms the calendar event was created.

Expected session state after second message:

- The same session remains `waiting_for_user` after the assistant reply; completion is proven by the completed tool event and reply.
- Timeline includes the second user message, calendar tool completion, and assistant confirmation.

Expected resource result:

- A calendar event exists with title or description containing `INTEX-E2E-003`.
- The event is scheduled for noon on the resolved next Tuesday in the test user's timezone.

## Scenario 4: Explicit New Session Supersedes Pending Clarification

User first types:

```text
Schedule INTEX-E2E-004 dentist at 4 PM.
```

Expected assistant behavior after first message:

- Says that a new session started.
- Asks for the missing day or date.
- Does not create a calendar event yet.

Expected session state after first message:

- Session status is `waiting_for_user`.
- Timeline shows a pending calendar clarification.

User then types:

```text
new session: remember that INTEX-E2E-004 backup code is 9988
```

Expected assistant behavior after second message:

- Does not treat the second message as the missing day for the dentist event.
- Says that the previous session was closed or superseded.
- Says that a new session started.
- Saves the backup code as a note.

Expected session state:

- The original calendar clarification session final status is `superseded` or `cancelled`.
- The original session end reason is user-driven superseding or cancellation.
- A new session exists for the note request.
- The new session remains `waiting_for_user` after the assistant reply; completion is proven by the completed tool event and reply.
- The new session tool is `create_note`.

Expected resource result:

- No calendar event is created for `INTEX-E2E-004 dentist`.
- A note exists with marker `INTEX-E2E-004` and code `9988`.

## Scenario 5: Unsupported Request Returns An Unsupported Outcome

User types:

```text
Book me an Uber to the airport for INTEX-E2E-005.
```

Expected assistant behavior:

- Replies in WhatsApp.
- Says that a new session started.
- Clearly says the request is not supported yet.
- Names supported Intex Agent capabilities instead of inventing an Uber booking flow.
- Does not call a note or calendar tool.

Expected session state:

- Session status remains `waiting_for_user` after the unsupported reply; the unsupported outcome is proven by the `unsupported_request` event.
- Timeline includes session start, user message, unsupported request event, and assistant unsupported reply.

Expected resource result:

- No note is created for `INTEX-E2E-005`.
- No calendar event is created for `INTEX-E2E-005`.

## Scenario 6: New Message After Completed Outcome Continues The Open Session

Precondition:

- Scenario 1 or any other one-message successful session has produced a completed tool outcome and is waiting for the user.

User types:

```text
Remember INTEX-E2E-006 parking is on level P3.
```

Expected assistant behavior:

- Replies in WhatsApp.
- Continues the same open session.
- Does not say that a new session started.
- Confirms the note was saved.

Expected session state:

- The existing `waiting_for_user` session is reused.
- The session remains `waiting_for_user` after the assistant reply; completion is proven by the completed tool event and reply.
- Timeline includes the new user message, the completed note tool outcome, and assistant confirmation.

Expected resource result:

- A note exists with marker `INTEX-E2E-006` and parking level `P3`.

## Scenario 7: Ambiguous Note-Like Message Should Become A Note, Not Unsupported

User types:

```text
Keep this for later: INTEX-E2E-007 passport expires in November 2029.
```

Expected assistant behavior:

- Says that a new session started.
- Saves the content as a note.
- Does not ask what the user wants to do.
- Does not classify it as unsupported.

Expected session state:

- Session status remains `waiting_for_user` after the assistant reply; completion is proven by the completed tool event and reply.
- Tool is `create_note`.
- Timeline includes note tool execution and assistant confirmation.

Expected resource result:

- A note exists with marker `INTEX-E2E-007`.
- The note content contains `passport expires in November 2029`.

## Scenario 8: Calendar Request Without Time Requires Clarification

User first types:

```text
Put INTEX-E2E-008 project review on my calendar for September 10 2026.
```

Expected assistant behavior after first message:

- Says that a new session started.
- Asks what time the event should be scheduled for, unless the implementation explicitly supports all-day event creation for this phrasing and tells the user that it is creating an all-day event.
- Does not create a timed event without user confirmation.

Expected session state after first message:

- If asking for time, session status is `waiting_for_user`.
- Timeline includes a clarification-requested event.

User then types:

```text
3 PM for one hour.
```

Expected assistant behavior after second message:

- Continues the same session.
- Confirms the calendar event was created.
- Does not start a new session.

Expected session state after second message:

- The same session remains `waiting_for_user` after the assistant reply; completion is proven by the completed tool event and reply.
- Tool is `create_calendar_event`.

Expected resource result:

- A calendar event exists with marker `INTEX-E2E-008`.
- The event starts September 10, 2026 at 3:00 PM in the test user's timezone.
- The event duration is one hour.

## Scenario 9: Explicit New Session With No Work Only Starts A Session

User types:

```text
new session
```

Expected assistant behavior:

- Closes any active or waiting session if one exists.
- Says that a new session started.
- Says what supported Intex Agent jobs it can help with next.
- Does not call any tool.

Expected session state:

- A new session exists with status `waiting_for_user`.
- Timeline includes session start and assistant message.
- No tool call events exist for this session.

Expected resource result:

- No note is created.
- No calendar event is created.

## Scenario 10: Voice Transcript Uses The Same Session Semantics

The test harness submits or simulates a completed WhatsApp voice transcription whose transcript is:

```text
Remember INTEX-E2E-010 the storage unit key is in the blue drawer.
```

Expected assistant behavior:

- Treats the transcript like a user WhatsApp Assistant message.
- Says that a new session started, or acknowledges the previous session then starts a new one.
- Saves the content as a note.
- Replies through the same WhatsApp Assistant channel.

Expected session state:

- Session status remains `waiting_for_user` after the assistant reply; completion is proven by the completed tool event and reply.
- Tool is `create_note`.
- Timeline records that the source was voice or transcription, while still showing the transcript text as the user message content.

Expected resource result:

- A note exists with marker `INTEX-E2E-010`.
- The note content contains `storage unit key is in the blue drawer`.

## Pass Criteria For The Testing Agent

The implementation passes this scenario suite when all executed scenarios demonstrate the expected user-facing behavior, session lifecycle, timeline records, and resource creation or non-creation.

Failures include:

- Starting a new product session silently.
- Continuing a superseded or expired session without telling the user a new session started.
- Treating explicit `new session` as clarification text.
- Creating a calendar event when required details are missing.
- Creating notes or calendar events for unsupported requests.
- Returning only machine-readable output without a WhatsApp-facing assistant message or, in `internal_mock_tools`, a captured assistant reply.
- Validating only raw response JSON without checking session timeline and created resources.
