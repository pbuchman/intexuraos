# Pub/Sub Dead-Letter Queue Runbook

Use this runbook when a production or retained development DLQ contains a
message, or when Cloud Monitoring reports an unsuccessful dead-letter forward.
DLQ inspection subscriptions retain unacknowledged messages for 31 days.

## Safety Rules

- Do not bulk replay. The same poison payload may appear many times after a
  forwarding or acknowledgement failure.
- Do not print decoded payloads in a terminal, ticket, pull request, or chat.
- Work on one selected message at a time and record its source subscription.
- Preserve the original correlation attributes when replaying a selected
  message.
- ACK a DLQ message only after its replay publish succeeds, or after an operator
  explicitly records why the message is permanently non-replayable.
- Use `gcloud` only for read, selected replay, and ACK operations. Persistent
  topics, subscriptions, IAM, retention, and alerts are changed through
  Terraform.

## 1. Identify the Failure Mode

Record the alert time, source subscription, DLQ inspection subscription, and
the forwarding response code. Classify the incident before touching a message:

1. permanent payload rejection;
2. transient consumer dependency failure;
3. consumer deployment outage;
4. Pub/Sub forwarding or IAM failure.

For a forwarding or IAM failure, verify that the Pub/Sub service agent has
`roles/pubsub.publisher` on the DLQ topic and `roles/pubsub.subscriber` on the
source subscription. Repair persistent IAM only in Terraform. A
`permission_denied` forwarding result can create duplicate DLQ copies when the
DLQ publish succeeds but the source ACK fails.

## 2. Check Backlogs Without Pulling Payloads

Use Cloud Monitoring or subscription descriptions to record source and DLQ
backlogs. Confirm that the selected DLQ name ends in `-dlq-sub` or contains
`-dlq-` and ends in `-inspect`. Do not use `--auto-ack` during investigation.

If a pull is required, create a private temporary directory with mode `0700`,
write the JSON response to a mode `0600` file, and arrange secure deletion when
the incident is complete. The pull output contains private message data and
must never be pasted into incident notes.

Record only these metadata fields:

- source and DLQ subscription names;
- Pub/Sub message ID and publish time;
- delivery attempt when present;
- encoded payload size;
- correlation ID and other non-sensitive routing attributes;
- SHA-256 payload hash.

Calculate payload size and the payload hash from the decoded bytes through a
pipe so the content is never written to standard output. Use the payload hash
with publish time and correlation metadata to identify repeated copies.

## 3. Decide Whether Replay Is Safe

Before replay, confirm all of the following:

1. the consumer defect, dependency outage, deployment outage, or IAM defect is
   fixed;
2. the destination consumer is healthy;
3. the consumer's idempotency behavior is understood for this event type;
4. no successfully processed message already has the same correlation ID or
   payload hash;
5. replay cannot contact an unintended external recipient.

Classify schema-invalid poison messages as non-replayable unless a reviewed
payload migration exists. Record the reason and ACK only the selected copy.

## 4. Replay One Selected Message

Republish only the selected decoded bytes to the original source topic. Preserve
the original correlation and routing attributes; add an operator replay marker
and incident reference without changing the business payload. Capture the new
Pub/Sub message ID as proof that publish succeeded.

After the publish succeeds, verify consumer logs using the correlation ID. Then
ACK the original DLQ message by its individual ACK ID. If publish or consumer
verification fails, do not ACK; let the inspection lease expire so the message
remains available inside the 31-day window.

Repeated copies with the same payload hash are handled individually only after
the first replay has been proven idempotent. Do not bulk replay or bulk ACK the
remaining copies.

## 5. Verify Recovery

Confirm all of the following before closing the incident:

- source subscription backlog is zero or falling normally;
- DLQ backlog is zero after selected ACKs, or every remaining entry has an
  owner and classification;
- `dead_letter_message_count` reports `response_code="success"` for new
  forwarding attempts;
- there are no new unsuccessful forwarding response codes;
- consumer logs show expected handling and no repeated external side effect;
- the 31-day retention deadline is recorded for any deferred entry.

## Synthetic Production Check

After an infrastructure rollout, publish exactly one uniquely marked invalid
WhatsApp event with no valid recipient and a new correlation ID. Record its
message ID and payload hash, wait for it to reach the dedicated
`intexuraos-whatsapp-send-prod-hetzner-dlq-sub` subscription, and verify the
forwarding response is `success`. Inspect and ACK only that synthetic entry.
Confirm afterward that both the source and DLQ backlogs are zero and that no
WhatsApp message was sent.
