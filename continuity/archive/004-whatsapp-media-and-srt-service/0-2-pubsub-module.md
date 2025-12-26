# 0-2: Create Pub/Sub Terraform Module

**Tier:** 0 (Infrastructure Setup)

---

## Context

Event-driven architecture requires Pub/Sub topics and subscriptions for:

1. `whatsapp.audio.stored` — triggers srt-service transcription
2. `whatsapp.media.cleanup` — async media deletion from GCS
3. Dead-letter topics for both

---

## Problem Statement

Need reusable Pub/Sub Terraform module that creates:

- Topics with configurable names
- Pull subscriptions with retry policy
- Dead-letter topic and subscription per main topic
- IAM bindings for publisher and subscriber service accounts

---

## Scope

**In scope:**

- Create `terraform/modules/pubsub/`
- Support for creating topic + pull subscription + DLQ
- IAM: publisher role for whatsapp-service, subscriber role for srt-service
- Wire topics in dev environment:
  - `whatsapp-audio-stored` (whatsapp publishes, srt subscribes)
  - `whatsapp-media-cleanup` (whatsapp publishes, whatsapp subscribes)
  - Dead-letter topics for both

**Out of scope:**

- Push subscriptions
- Application code

---

## Required Approach

1. Create module with variables for topic name, subscriber SA, publisher SA
2. Create main topic + subscription
3. Create dead-letter topic + subscription (5 max delivery attempts)
4. IAM bindings for pub/sub roles
5. Wire in dev environment for both event types

---

## Step Checklist

- [ ] Create `terraform/modules/pubsub/main.tf`
- [ ] Create `terraform/modules/pubsub/variables.tf`
- [ ] Create `terraform/modules/pubsub/outputs.tf`
- [ ] Add module call for `whatsapp-audio-stored` topic
- [ ] Add module call for `whatsapp-media-cleanup` topic
- [ ] Grant whatsapp-service pubsub.publisher on both topics
- [ ] Grant srt-service pubsub.subscriber on audio-stored subscription
- [ ] Grant whatsapp-service pubsub.subscriber on media-cleanup subscription
- [ ] Add topic/subscription names as env vars to services
- [ ] Run terraform fmt
- [ ] Run terraform validate

---

## Definition of Done

- Two topics with pull subscriptions and DLQ created
- Correct IAM bindings for each service
- Topic/subscription names available as outputs
- Terraform validates successfully

---

## Verification Commands

```bash
cd terraform/environments/dev
terraform fmt -check -recursive
terraform validate
```

---

## Rollback Plan

Remove module calls from dev/main.tf, delete module directory.
