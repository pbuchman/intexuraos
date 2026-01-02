# User Approval Workflow for Actions

## Goal

Introduce user approval workflow for all actions. Actions will no longer execute automatically - users must explicitly approve them first via WhatsApp notifications and web UI.

## Scope

### In Scope
- Add `awaiting_approval` action status
- Move all action endpoints from commands-router to actions-agent
- Transfer Firestore ownership of `actions` collection to actions-agent
- Create action creation endpoint in actions-agent (for commands-router)
- Create public execute endpoint for user-initiated execution
- Implement WhatsApp notifications on approval needed and completion
- Add confirmation dialogs and inbox deep linking in web UI
- Update action configuration for approve/retry buttons

### Out of Scope
- Approval workflow for todo, note, calendar, link actions (research only for now)
- Email notifications
- SMS notifications
- Push notifications via mobile app

## Constraints

### Architectural
1. **commands-router has ZERO direct Firestore access to actions collection**
   - Must call actions-agent endpoints to create/read/update actions
2. **actions-agent owns entire action lifecycle**
   - Creation, status updates, execution, deletion
3. **No cross-app imports**
   - Each app defines its own Action type
4. **Firestore ownership verification**
   - `npm run verify:firestore` must pass
5. **WhatsApp integration via Pub/Sub**
   - Use `@intexuraos/infra-pubsub` package
   - No direct HTTP calls to whatsapp-service

### Technical
- All action reads/writes go through actions-agent
- Execute endpoint must be synchronous (wait for completion)
- Idempotent execute (can retry failed actions)
- Hash-based routing for resource URLs (`/#/research/abc123/edit`)
- Confirmation dialogs before destructive actions

## Success Criteria

### Functionality
- [ ] User receives WhatsApp notification when action awaits approval
- [ ] WhatsApp link opens inbox with action modal
- [ ] User can approve action via web UI
- [ ] Execute endpoint creates research draft synchronously
- [ ] User receives WhatsApp notification when draft is ready
- [ ] Retry button works for failed actions
- [ ] Frontend shows correct buttons based on action status

### Technical
- [ ] `npm run ci` passes
- [ ] `npm run verify:firestore` passes
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Test coverage maintained (≥80%)
- [ ] All unit tests pass
- [ ] Integration tests pass

### Architecture
- [ ] commands-router has no Firestore action references
- [ ] actions-agent owns actions collection
- [ ] All action endpoints moved to actions-agent
- [ ] Architecture documentation created
- [ ] Firestore ownership updated

### Migration
- [ ] Existing pending actions manually deleted (pre-deployment)
- [ ] Old auto-execution code removed
- [ ] No breaking changes to existing completed actions

## Dependencies

### Packages
- `@intexuraos/infra-pubsub` - WhatsApp message publishing
- `@intexuraos/infra-firestore` - Firestore access
- `@intexuraos/common-http` - JWT validation, internal auth
- `@intexuraos/common-core` - Result types

### Services
- user-service - User phone number lookup
- whatsapp-service - WhatsApp message delivery
- llm-orchestrator - Research draft creation
- commands-router - Action classification

### Environment Variables
- `INTEXURAOS_WEB_APP_URL` - Base URL for deep links
- `INTEXURAOS_GCP_PROJECT_ID` - Pub/Sub project
- `INTEXURAOS_WHATSAPP_SEND_TOPIC` - Pub/Sub topic
- `INTEXURAOS_USER_SERVICE_URL` - User service URL
- `INTEXURAOS_ACTIONS_AGENT_URL` - Actions agent URL (frontend)

## Rollback Plan

**Phase-based deployment with rollback points:**

1. **Phase 1 fails**: Revert actions-agent, old auto-execution restored
2. **Phase 2 fails**: Revert commands-router, actions-agent still works with old flow
3. **Phase 3 fails**: Revert web app deployment

**Emergency rollback:**
- Keep old auto-execution code in comments for 1 week post-deployment
- Manual Firestore restore from backup if needed
- Monitor Cloud Logging for errors after each phase

## Notes

- This is a **major architectural change** affecting multiple services
- Breaking change: all existing pending actions will be orphaned
- Manual cleanup required before deployment
- Test with low-volume user first
- Resource URL format critical for proper navigation

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 2-1-coverage-verification.md without waiting for user input.
