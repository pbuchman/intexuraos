# WhatsApp → PraxOS Inbox Implementation Gaps

## Prerequisites (Must be completed first)

### 1. Create WhatsApp webhook payload types and validation

- Location: `packages/domain/whatsapp/`
- Create TypeScript types for WhatsApp Business Cloud API webhook payloads
- Include: `WebhookPayload`, `MessageEntry`, `TextMessage`, `Contact`
- Add Zod schemas for runtime validation
- Reference: Meta WhatsApp Business Cloud API documentation
- Tests required: Schema validation for valid/invalid payloads

### 2. Create InboxNote domain model

- Location: `packages/domain/inbox/`
- Create `InboxNote` entity matching schema in `docs/notion-inbox.md`
- Properties: Title, Status, Source, MessageType, Type, Topic, OriginalText, CleanText, Sender, ExternalID, CapturedAt, URL
- Include factory function `createInboxNote(params): InboxNote`
- No external dependencies (pure domain)
- Tests required: Entity creation, validation of required fields

### 3. Create InboxNote repository port (interface)

- Location: `packages/domain/inbox/`
- Define `InboxNoteRepository` interface with `create(note: InboxNote): Promise<Result<InboxNote, Error>>`
- This is the port in hexagonal architecture
- Tests required: N/A (interface only)

### 4. Create WhatsApp user mapping domain types

- Location: `packages/domain/identity/` or `packages/domain/whatsapp/`
- Create `WhatsAppUserMapping` type: `{ phoneNumber: string, userId: string }`
- Create `WhatsAppUserMappingRepository` port interface
- Methods: `findByPhoneNumber(phone: string): Promise<Result<WhatsAppUserMapping | null, Error>>`
- Tests required: Type validation

### 5. Create webhook persistence domain types

- Location: `packages/domain/whatsapp/`
- Create `WebhookRecord` entity with:
  - `id`, `payload`, `status`, `rejectionReason`, `createdAt`
- Status enum: `PROCESSED`, `FAILED`, `USER_UNMAPPED`, `IGNORED`
- Rejection reasons enum: `UNSUPPORTED_PHONE_NUMBER`, `UNSUPPORTED_MESSAGE_TYPE`, `USER_NOT_FOUND`, etc.
- Create `WebhookRepository` port interface
- Tests required: Entity creation, status transitions

---

## Infrastructure Layer (Depends on domain layer)

### 6. Create Firestore adapter for webhook persistence

- Location: `packages/infra/firestore/`
- Implement `WebhookRepository` port
- Collection: `whatsapp_webhooks`
- Store full payload, status, rejection reason, timestamps
- Tests required: CRUD operations with mocked Firestore

### 7. Create Firestore adapter for WhatsApp user mappings

- Location: `packages/infra/firestore/`
- Implement `WhatsAppUserMappingRepository` port
- Collection: `whatsapp_user_mappings`
- Index on `phoneNumber` for lookups
- Tests required: findByPhoneNumber with mocked Firestore

### 8. Create Notion adapter for InboxNote persistence

- Location: `packages/infra/notion/`
- Implement `InboxNoteRepository` port
- Use database ID from `docs/notion-inbox.md`: `fd13e74a-1128-495f-ae24-8a70acf30f62`
- Map domain `InboxNote` to Notion API property format per `docs/notion-inbox.md` Section 4.1
- Tests required: Property mapping, API call structure with mocked Notion client

### 9. Create WhatsApp messaging adapter (outgoing messages)

- Location: `packages/infra/whatsapp/`
- Create `WhatsAppMessenger` port in domain
- Implement adapter using WhatsApp Business Cloud API
- Method: `sendTextMessage(to: string, message: string): Promise<Result<void, Error>>`
- Use secrets: `PRAXOS_WHATSAPP_ACCESS_TOKEN`, `PRAXOS_WHATSAPP_PHONE_NUMBER_ID`
- Tests required: API call structure with mocked HTTP client

---

## Application Service Layer (Depends on infrastructure adapters)

### 10. Create ProcessWhatsAppWebhook use case

- Location: `apps/whatsapp-service/src/application/` or `packages/domain/whatsapp/`
- Orchestrates the full flow:
  1. Persist webhook (always)
  2. Validate target phone number → return 400 if invalid
  3. Validate message type → send notification if unsupported
  4. Lookup user mapping → send notification if unmapped
  5. Create InboxNote domain object
  6. Load user's Notion config
  7. Write to Notion
  8. Send success/failure notification
  9. Update webhook status
- Inject all repository ports via constructor
- Tests required: Full flow with mocked ports, all status paths

### 11. Create WhatsApp service configuration

- Location: `apps/whatsapp-service/src/config/`
- Environment variables:
  - `PRAXOS_WHATSAPP_SERVED_PHONE_NUMBERS` (comma-separated list)
  - `PRAXOS_WHATSAPP_ACCESS_TOKEN`
  - `PRAXOS_WHATSAPP_PHONE_NUMBER_ID`
  - `PRAXOS_WHATSAPP_VERIFY_TOKEN`
  - `PRAXOS_WHATSAPP_APP_SECRET`
- Validate at startup
- Tests required: Config validation, missing env handling

---

## HTTP Layer (Depends on application services)

### 12. Create webhook verification endpoint (GET)

- Location: `apps/whatsapp-service/src/routes/webhooks/`
- Endpoint: `GET /webhooks/whatsapp`
- Verify `hub.verify_token` matches `PRAXOS_WHATSAPP_VERIFY_TOKEN`
- Return `hub.challenge` on success, 403 on failure
- Tests required: Verification flow

### 13. Create webhook handler endpoint (POST)

- Location: `apps/whatsapp-service/src/routes/webhooks/`
- Endpoint: `POST /webhooks/whatsapp`
- Validate webhook signature using `PRAXOS_WHATSAPP_APP_SECRET`
- Parse and validate payload
- Call `ProcessWhatsAppWebhook` use case
- Return appropriate HTTP status per spec (200 or 400)
- Tests required: Signature validation, payload parsing, status codes

### 14. Create Fastify route registration

- Location: `apps/whatsapp-service/src/routes/`
- Register webhook routes with Fastify
- Add request logging
- Add error handling middleware
- Tests required: Route registration, error handling

---

## User Mapping Management (Parallel track)

### 15. Create WhatsApp connection management endpoints

- Location: `apps/whatsapp-service/src/routes/connections/` or separate admin service
- Endpoints analogous to Notion connection flow:
  - `POST /connections/whatsapp` - create mapping
  - `GET /connections/whatsapp/:userId` - get mappings for user
  - `DELETE /connections/whatsapp/:phoneNumber` - remove mapping
- Requires authentication
- Tests required: CRUD operations, auth checks

---

## Notification Messages (Depends on WhatsApp adapter)

### 16. Define notification message templates

- Location: `packages/domain/whatsapp/` or config
- Messages for:
  - Success: "Your note has been saved to PraxOS."
  - Unsupported message type: "Only text messages are supported at this time."
  - User unmapped: "This phone number is not connected to a PraxOS account."
  - Processing failed: "Failed to save your note. Please try again later."
- Tests required: Template rendering

---

## Infrastructure Setup

### 17. Add Firestore collections and indexes

- Location: `terraform/` or Firestore setup scripts
- Collections:
  - `whatsapp_webhooks`
  - `whatsapp_user_mappings` (index on `phoneNumber`)
- Tests required: N/A (infrastructure)

### 18. Add Secret Manager secrets for WhatsApp

- Location: `terraform/`
- Secrets per `docs/setup/07-whatsapp-business-cloud-api.md`:
  - `PRAXOS_WHATSAPP_VERIFY_TOKEN`
  - `PRAXOS_WHATSAPP_ACCESS_TOKEN`
  - `PRAXOS_WHATSAPP_PHONE_NUMBER_ID`
  - `PRAXOS_WHATSAPP_WABA_ID`
  - `PRAXOS_WHATSAPP_APP_SECRET`
- Tests required: N/A (infrastructure)

---

## Integration & E2E Tests

### 19. Create integration tests for full webhook flow

- Location: `apps/whatsapp-service/src/__tests__/`
- Test complete flow with mocked external services
- Cover all webhook statuses: PROCESSED, FAILED, USER_UNMAPPED, IGNORED
- Tests required: This IS the test task

### 20. Update CI/CD for whatsapp-service

- Location: `.github/workflows/` or existing CI config
- Add whatsapp-service to build/test pipeline
- Ensure coverage thresholds are met (90%+ per copilot-instructions.md)
- Tests required: N/A (CI config)

---

## Documentation

### 21. Create whatsapp-service README

- Location: `apps/whatsapp-service/README.md`
- Brief purpose statement
- Links to `docs/setup/07-whatsapp-business-cloud-api.md`
- Links to `docs/notion-inbox.md`

### 22. Update docs/notion-inbox.md if schema changes discovered

- Verify all property names match actual Notion database
- Document any discrepancies found during implementation

---

## Verification Checklist (Per Task)

Each task above must satisfy:

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:coverage` passes with ≥90% coverage
- [ ] `npm run ci` passes
- [ ] No `any` types without justification
- [ ] Explicit return types on all exported functions
- [ ] Result types for operations that can fail
- [ ] Domain layer has no external dependencies
- [ ] Infrastructure adapters implement domain ports
- [ ] Update of status tracking in this document by adding prefix [COMPLETED] to each finished task
- [ ] Execute add git commit with message "feat(whatsapp-service): implement [TASK NAME]"
