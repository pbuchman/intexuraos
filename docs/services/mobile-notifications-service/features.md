# Mobile Notifications Service

Push notification gateway for mobile devices via signature-based authentication.

## The Problem

Mobile apps need real-time notifications:

1. **Authentication** - Devices need secure push token access
2. **Filtering** - Users should control which notifications they receive
3. **Multi-device** - Users have multiple devices (phone, tablet)
4. **Webhook delivery** - Push providers send webhooks, not polling

## How It Helps

Mobile-notifications-service manages the entire push flow:

1. **Signature connections** - Cryptographic tokens for device auth
2. **Notification storage** - Persistent notification history
3. **Filters** - Per-user notification preferences
4. **Webhooks** - Receive push from external providers
5. **Mobile delivery** - Send push to registered devices

## Key Features

**Connection Types:**
- Signature-based (plaintext returned once, stored hashed)
- Device labeling for identification

**Notification Filters:**
- Enable/disable by source
- Priority filtering

**Webhook Support:**
- Receive push from external providers
- Verify signatures
- Route to connected devices

## Use Cases

### Connect device

1. App requests connection with device label
2. Service generates signature token
3. App stores plaintext token (shown only once)
4. Service stores hash for verification
5. App uses token for webhook auth

### Receive notification

1. External provider POSTs to webhook
2. Signature verified
3. Notification stored in Firestore
4. Pushed to user's connected devices

## Key Benefits

**Secure** - Hashed signatures, plaintext shown once

**Multi-device** - Multiple connections per user

**Filtering** - User controls notification sources

**Audit trail** - All notifications stored

## Limitations

**No built-in push provider** - Relies on external webhooks

**Signature only shown once** - Lost tokens require reconnect

**No sound/badge customization** - Basic notification only
