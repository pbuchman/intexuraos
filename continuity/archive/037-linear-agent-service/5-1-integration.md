# Task 5-1: End-to-End Integration Testing

## Tier

5 (Deployment - Final)

## Context

Service is deployed. Now verify end-to-end functionality.

## Problem Statement

Need to verify:

1. Web app can connect to Linear
2. Voice commands classify as 'linear' type
3. Issues are created in Linear
4. Dashboard shows issues correctly

## Scope

### In Scope

- Manual testing of connection flow
- Manual testing of voice command flow
- Dashboard verification
- Document any issues found

### Out of Scope

- Automated e2e tests (future enhancement)
- Production deployment

## Required Approach

1. **Open** web app at configured URL
2. **Navigate** to Linear connection page
3. **Configure** with real Linear API key
4. **Test** via WhatsApp (if available) or direct API
5. **Verify** dashboard displays issues

## Step Checklist

- [ ] Open web app and navigate to Linear connection
- [ ] Enter Linear Personal API key and validate
- [ ] Select team and save connection
- [ ] Verify connection status shows connected
- [ ] Navigate to Linear Issues page
- [ ] Verify issues load from Linear
- [ ] Test creating issue via API or WhatsApp
- [ ] Verify new issue appears in Linear and dashboard
- [ ] Document any bugs found for follow-up

## Definition of Done

- Connection flow works end-to-end
- Issues display correctly in dashboard
- Voice command creates issue in Linear (if testable)
- No critical bugs blocking basic functionality

## Testing Steps

### 1. Connection Flow

1. Go to `https://your-app-url/#/linear/connection`
2. Click "Connect Linear"
3. Enter your Linear Personal API key (create at https://linear.app/settings/api)
4. Click "Validate" - should show team selection
5. Select a team and click "Save Connection"
6. Should show "Connected" status with team name

### 2. Dashboard Flow

1. Navigate to `https://your-app-url/#/linear`
2. Should load issues grouped by column
3. Click an issue - should open in Linear
4. Wait 1 minute - should auto-refresh

### 3. Issue Creation Flow (via WhatsApp)

1. Send message to WhatsApp bot: "nowe zadanie w linear: test issue from voice"
2. Wait for classification and routing
3. Check Linear for new issue
4. Check dashboard for new issue

### 4. Issue Creation Flow (via API)

If WhatsApp not available, test via curl:

```bash
# Get auth token from browser (Network tab)
TOKEN="your-jwt-token"

# Create action via commands-agent (simulates WhatsApp)
curl -X POST "https://intexuraos-commands-agent-XXX.run.app/commands" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "nowe zadanie w linear: test issue from API",
    "sourceType": "pwa-shared"
  }'
```

## Known Limitations

- Auto-execution disabled by default - actions go to awaiting_approval
- User must approve action in inbox before execution
- Or can directly execute via actions-agent API

## Bugs to Track

If any issues found, create Linear issues for them:

- [ ] Bug 1: [description]
- [ ] Bug 2: [description]

---

## Final Task - No Continuation

This is the final task. After completing verification:

1. Update CONTINUITY.md marking all tasks complete
2. Archive the continuity folder to `continuity/archive/037-linear-agent-service/`
3. Report completion to user

## Completion Report Template

```
Linear Agent Service - Implementation Complete

Summary:
- Created linear-agent service with full CRUD for Linear issues
- Added 'linear' action type to commands-agent classification
- Integrated with actions-agent for routing
- Created web UI with connection page and issues dashboard

Features Delivered:
- Linear API key connection via web UI
- Team selection during setup
- LLM extraction of issue title, priority, functional/technical details
- Voice command classification ("create linear issue", "dodaj do lineara")
- Dashboard with 3 columns + archive
- 1-minute polling for updates
- Mobile-responsive with tabs

Endpoints:
- GET /linear/connection - Get connection status
- POST /linear/connection - Save connection
- DELETE /linear/connection - Disconnect
- POST /linear/connection/validate - Validate API key
- GET /linear/issues - List grouped issues
- POST /internal/linear/process-action - Process voice command

Testing:
- All unit tests pass (95% coverage)
- Integration testing complete
- Service healthy on Cloud Run

Next Steps:
- Monitor for any production issues
- Consider adding issue updates (currently read-only)
- Consider webhook integration for real-time updates
```
