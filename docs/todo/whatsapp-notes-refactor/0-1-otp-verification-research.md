# 0-1 OTP Verification Research

**Tier:** 0 (Prerequisite Research)  
**Status:** Pending

## Context Snapshot

When a user connects WhatsApp, they currently just enter their phone number(s) and a Notion database ID. There is no verification that the user actually owns/controls the phone number they're registering.

After removing Notion connection (task 0-0), we need to plan how to verify phone number ownership before allowing WhatsApp connection.

## Problem Statement

Without phone number verification:

- Any user could claim any phone number
- Messages from that number would be associated with the wrong user
- Security/privacy risk — someone could intercept another user's messages

Need to research and document the OTP verification flow for WhatsApp number verification.

## Scope

**In scope:**

- Research WhatsApp OTP verification approaches
- Document the verification flow design
- Identify technical requirements and constraints
- Create implementation plan (no actual implementation)
- Output: `docs/whatsapp-otp.md`

**Out of scope:**

- Actual implementation of OTP flow
- Changes to existing code

## Required Approach

Research the following and document findings:

1. **WhatsApp Business API OTP capabilities**
   - Does the API support sending OTP codes?
   - Rate limits and restrictions
   - Template message requirements

2. **Verification flow design**
   - User initiates connection with phone number
   - System sends OTP to that WhatsApp number
   - User enters OTP in web app
   - System verifies and completes connection

3. **Technical considerations**
   - OTP storage (temporary, with expiry)
   - Rate limiting (prevent abuse)
   - Retry logic
   - Expiry time (typical: 5-10 minutes)
   - OTP format (6-digit numeric typical)

4. **Security considerations**
   - Brute force protection
   - Timing attacks
   - Replay attacks

5. **User experience**
   - Clear instructions
   - Error messages
   - Retry flow

## Step Checklist

- [ ] Research WhatsApp Business Cloud API message templates
- [ ] Research OTP delivery via WhatsApp
- [ ] Design verification state machine
- [ ] Document API endpoints needed
- [ ] Document Firestore collections for OTP state
- [ ] Document rate limiting approach
- [ ] Document security measures
- [ ] Write complete `docs/whatsapp-otp.md`
- [ ] Run `npx prettier --write .`

## Definition of Done

- `docs/whatsapp-otp.md` exists with complete research
- Document covers all sections: flow, API design, storage, security, UX
- No implementation — research only
- Document dated 25 Dec 2025

## Verification Commands

===

# Check document exists and is properly formatted

cat docs/whatsapp-otp.md
npx prettier --write docs/whatsapp-otp.md
===

## Rollback Plan

Delete `docs/whatsapp-otp.md` if needed. No code changes involved.
