# WhatsApp Phone Number Verification via OTP

**Document Version:** 1.0  
**Research Date:** 25 December 2025  
**Status:** Research Complete — Implementation Pending

---

## 1. Executive Summary

This document outlines the design for verifying phone number ownership when users connect WhatsApp to IntexuraOS. The system will send a one-time password (OTP) via WhatsApp to the phone number being registered, and the user must enter this code in the web app to prove ownership.

**Key Decisions:**

- Use WhatsApp Business Cloud API to send OTP messages
- 6-digit numeric OTP with 5-minute expiry
- Maximum 3 attempts before lockout
- Rate limit: 1 OTP request per phone number per 60 seconds

---

## 2. Problem Statement

### Current State

Users can register any phone number without verification. This creates security risks:

- Malicious users could claim phone numbers they don't own
- Messages from victims would be associated with attackers' accounts
- Privacy breach — attacker sees all messages sent to the claimed number

### Target State

Phone number ownership must be verified before WhatsApp connection is established. The registered phone number's owner must prove control by receiving and entering an OTP.

---

## 3. WhatsApp Business Cloud API Capabilities

### 3.1 Message Types for OTP

**Option A: Template Messages (Recommended)**

- Pre-approved message templates required
- Must be approved by Meta before use
- Supports authentication/OTP category
- Example template: "Your IntexuraOS verification code is {{1}}. Valid for 5 minutes."

**Option B: Session Messages**

- Only available within 24-hour window after user messages first
- NOT suitable for initial verification (user hasn't messaged yet)

**Decision:** Use Template Messages with authentication category.

### 3.2 Template Registration Requirements

Template requirements for authentication:

- Category: `AUTHENTICATION`
- Content type: OTP
- Variables: `{{1}}` for the OTP code
- Character limits: Body max 1024 chars
- Must include security disclaimer if required by locale

Example template submission:

```
Name: intexuraos_otp_verification
Category: AUTHENTICATION
Language: en
Body: Your IntexuraOS verification code is {{1}}. This code expires in 5 minutes. Do not share this code with anyone.
```

### 3.3 Rate Limits

WhatsApp Cloud API rate limits:

- 80 messages/second for business-initiated messages (template)
- Per-phone-number rate limits apply to recipients
- Recommendation: Implement application-level rate limiting stricter than API limits

### 3.4 API Endpoint

```
POST https://graph.facebook.com/v21.0/{phone_number_id}/messages

{
  "messaging_product": "whatsapp",
  "to": "{recipient_phone_number}",
  "type": "template",
  "template": {
    "name": "intexuraos_otp_verification",
    "language": { "code": "en" },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "123456" }
        ]
      }
    ]
  }
}
```

---

## 4. Verification Flow Design

### 4.1 State Machine

```
┌─────────────┐
│   INITIAL   │
└──────┬──────┘
       │ User submits phone number
       ▼
┌─────────────┐
│   PENDING   │──────────────────┐
│  OTP_SENT   │                  │
└──────┬──────┘                  │
       │                         │
       │ User enters code        │ Timeout (5 min)
       ▼                         │
┌─────────────┐                  │
│  VERIFYING  │                  │
└──────┬──────┘                  │
       │                         │
   ┌───┴───┐                     │
   │       │                     │
   ▼       ▼                     ▼
┌──────┐ ┌──────┐          ┌──────────┐
│VALID │ │FAILED│          │ EXPIRED  │
└──────┘ └──┬───┘          └──────────┘
            │
            │ attempts < 3
            ▼
      ┌───────────┐
      │  RETRY    │
      └───────────┘
            │ attempts >= 3
            ▼
      ┌───────────┐
      │  LOCKED   │
      └───────────┘
```

### 4.2 User Flow

1. **Initiate Connection**
   - User enters phone number in web app
   - Clicks "Send Verification Code"

2. **OTP Delivery**
   - System generates 6-digit OTP
   - Stores OTP hash in Firestore with metadata
   - Sends OTP via WhatsApp template message
   - UI shows "Code sent" confirmation

3. **Code Entry**
   - User receives WhatsApp message with OTP
   - User enters OTP in web app
   - System validates OTP

4. **Completion**
   - On valid OTP: Create user mapping, show success
   - On invalid OTP: Show error, allow retry (up to 3 attempts)
   - On lockout: Show error, require waiting period

---

## 5. API Endpoints Design

### 5.1 Request OTP

```
POST /v1/whatsapp/verify/request

Request:
{
  "phoneNumber": "+48123456789"
}

Response 200:
{
  "success": true,
  "data": {
    "verificationId": "ver_abc123",
    "expiresAt": "2025-12-25T12:05:00Z",
    "phoneNumberMasked": "+48***456789"
  }
}

Response 429 (rate limited):
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Please wait 60 seconds before requesting another code",
    "retryAfter": 45
  }
}

Response 409 (phone already mapped):
{
  "success": false,
  "error": {
    "code": "PHONE_ALREADY_MAPPED",
    "message": "This phone number is already connected to another account"
  }
}
```

### 5.2 Verify OTP

```
POST /v1/whatsapp/verify/confirm

Request:
{
  "verificationId": "ver_abc123",
  "code": "123456"
}

Response 200:
{
  "success": true,
  "data": {
    "phoneNumbers": ["+48123456789"],
    "connected": true,
    "createdAt": "2025-12-25T12:01:30Z"
  }
}

Response 400 (invalid code):
{
  "success": false,
  "error": {
    "code": "INVALID_CODE",
    "message": "Incorrect verification code",
    "attemptsRemaining": 2
  }
}

Response 400 (expired):
{
  "success": false,
  "error": {
    "code": "CODE_EXPIRED",
    "message": "Verification code has expired. Please request a new code."
  }
}

Response 423 (locked):
{
  "success": false,
  "error": {
    "code": "VERIFICATION_LOCKED",
    "message": "Too many failed attempts. Please try again in 15 minutes.",
    "lockedUntil": "2025-12-25T12:20:00Z"
  }
}
```

### 5.3 Resend OTP

```
POST /v1/whatsapp/verify/resend

Request:
{
  "verificationId": "ver_abc123"
}

Response 200:
{
  "success": true,
  "data": {
    "verificationId": "ver_def456",  // New ID
    "expiresAt": "2025-12-25T12:10:00Z"
  }
}
```

---

## 6. Firestore Data Model

### 6.1 Collection: `whatsapp_verifications`

Document ID: Auto-generated (verification ID)

```typescript
interface WhatsAppVerification {
  id: string; // Document ID / verification ID
  userId: string; // User requesting verification
  phoneNumber: string; // Phone number being verified (E.164)
  phoneNumberHash: string; // SHA256 hash for lookups
  codeHash: string; // SHA256 hash of OTP (never store plaintext)
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'LOCKED';
  attempts: number; // Failed verification attempts
  createdAt: string; // ISO timestamp
  expiresAt: string; // ISO timestamp (createdAt + 5 min)
  lockedUntil?: string; // ISO timestamp if locked
  lastAttemptAt?: string; // ISO timestamp of last attempt
  messageId?: string; // WhatsApp message ID for tracking
}
```

### 6.2 Indexes Required

```
Collection: whatsapp_verifications
Index 1: userId ASC, createdAt DESC
Index 2: phoneNumberHash ASC, status ASC, createdAt DESC
```

### 6.3 TTL / Cleanup

- Documents with `status: EXPIRED` or `status: VERIFIED`: Delete after 24 hours
- Documents with `status: LOCKED`: Delete after `lockedUntil` + 24 hours
- Implement via Cloud Functions scheduled task or Firestore TTL

---

## 7. Security Considerations

### 7.1 OTP Generation

- Use cryptographically secure random number generator
- 6 digits: 000000-999999 (1 million combinations)
- Never log OTP values
- Store only SHA256 hash of OTP

```typescript
import { randomInt, createHash } from 'node:crypto';

function generateOTP(): { code: string; hash: string } {
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const hash = createHash('sha256').update(code).digest('hex');
  return { code, hash };
}
```

### 7.2 Brute Force Protection

- Maximum 3 attempts per verification
- After 3 failures: Lock for 15 minutes
- Rate limit OTP requests: 1 per phone number per 60 seconds
- Rate limit verification attempts: 5 per user per 15 minutes

### 7.3 Timing Attack Prevention

- Use constant-time comparison for OTP verification
- Return same response time regardless of failure reason

```typescript
import { timingSafeEqual } from 'node:crypto';

function verifyOTP(providedCode: string, storedHash: string): boolean {
  const providedHash = createHash('sha256').update(providedCode).digest();
  const expectedHash = Buffer.from(storedHash, 'hex');
  return timingSafeEqual(providedHash, expectedHash);
}
```

### 7.4 Replay Attack Prevention

- Each verification ID is single-use
- On successful verification, mark as VERIFIED immediately
- Expired verifications cannot be reused

### 7.5 Phone Number Enumeration Prevention

- Same response for "phone already mapped" and "phone not found" in verify endpoint
- Rate limiting applies regardless of phone number existence

---

## 8. Rate Limiting Implementation

### 8.1 Limits

| Action      | Limit | Window           | Scope               |
| ----------- | ----- | ---------------- | ------------------- |
| Request OTP | 1     | 60 seconds       | Per phone number    |
| Request OTP | 5     | 15 minutes       | Per user            |
| Verify OTP  | 3     | Per verification | Per verification ID |
| Resend OTP  | 3     | 15 minutes       | Per phone number    |

### 8.2 Storage

Use Firestore or Redis for rate limit counters:

```typescript
interface RateLimitEntry {
  key: string; // e.g., "otp_request:{phoneHash}"
  count: number;
  windowStart: string; // ISO timestamp
  expiresAt: string; // ISO timestamp
}
```

---

## 9. User Experience

### 9.1 UI Flow

**Step 1: Enter Phone Number**

```
┌────────────────────────────────────────┐
│ Connect WhatsApp                       │
│                                        │
│ Enter your WhatsApp phone number:      │
│ ┌────────────────────────────────────┐ │
│ │ +48 123 456 789                    │ │
│ └────────────────────────────────────┘ │
│                                        │
│ [Send Verification Code]               │
└────────────────────────────────────────┘
```

**Step 2: Enter OTP**

```
┌────────────────────────────────────────┐
│ Enter Verification Code                │
│                                        │
│ We sent a 6-digit code to:             │
│ +48 *** *** 789                        │
│                                        │
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐         │
│ │  │ │  │ │  │ │  │ │  │ │  │         │
│ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘         │
│                                        │
│ Code expires in 4:32                   │
│                                        │
│ [Verify]                               │
│                                        │
│ Didn't receive the code? [Resend]      │
└────────────────────────────────────────┘
```

**Step 3: Success**

```
┌────────────────────────────────────────┐
│ ✅ Phone Number Verified               │
│                                        │
│ +48 123 456 789 is now connected       │
│ to your IntexuraOS account.            │
│                                        │
│ [Go to WhatsApp Notes]                 │
└────────────────────────────────────────┘
```

### 9.2 Error Messages

| Scenario       | Message                                                  |
| -------------- | -------------------------------------------------------- |
| Invalid code   | "Incorrect code. 2 attempts remaining."                  |
| Expired code   | "Code expired. Please request a new one."                |
| Locked         | "Too many attempts. Try again in 15 minutes."            |
| Rate limited   | "Please wait 45 seconds before requesting another code." |
| Already mapped | "This phone number is connected to another account."     |
| Send failure   | "Failed to send code. Please try again."                 |

### 9.3 Accessibility

- Auto-focus on first OTP input field
- Allow paste of full 6-digit code
- Clear error messages with ARIA labels
- Keyboard navigation support

---

## 10. Implementation Checklist

### Backend (whatsapp-service)

- [ ] Create `WhatsAppVerification` domain model
- [ ] Create `WhatsAppVerificationRepository` port
- [ ] Implement Firestore adapter for verifications
- [ ] Create `RequestOTPUseCase`
- [ ] Create `VerifyOTPUseCase`
- [ ] Create `ResendOTPUseCase`
- [ ] Implement rate limiting
- [ ] Add routes: `/v1/whatsapp/verify/request`, `/confirm`, `/resend`
- [ ] Register WhatsApp message template with Meta
- [ ] Add integration tests
- [ ] Update OpenAPI spec

### Frontend (web app)

- [ ] Create OTP input component
- [ ] Create verification flow pages
- [ ] Add countdown timer for expiry
- [ ] Implement resend functionality
- [ ] Add loading states
- [ ] Add error handling UI
- [ ] Update WhatsApp connection page

### Infrastructure

- [ ] Add Firestore index for `whatsapp_verifications`
- [ ] Configure Firestore TTL policy
- [ ] Add monitoring/alerting for OTP failures

---

## 11. Future Considerations

### Not in Scope (MVP)

- SMS fallback if WhatsApp delivery fails
- Voice call OTP option
- Multiple language support for OTP message
- Admin UI for managing verifications

### Post-MVP Enhancements

- Analytics: Track verification success rates
- A/B test: OTP length (4 vs 6 digits)
- WhatsApp interactive buttons for OTP confirmation
- Fraud detection: Flag suspicious verification patterns

---

## 12. References

- [WhatsApp Cloud API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [WhatsApp Message Templates](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Authentication Templates Guide](https://developers.facebook.com/docs/whatsapp/message-templates/guidelines/authentication-templates)
- [OWASP OTP Guidelines](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
