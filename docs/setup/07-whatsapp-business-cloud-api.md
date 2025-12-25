# WhatsApp Business Cloud API Setup

This guide covers setting up the WhatsApp Business Cloud API for IntexuraOS integration.

> **Target date**: 2025-12-18. Steps reflect the expected Meta UI as of this date; if the UI differs, follow the closest matching screens and consult [official Meta documentation](https://developers.facebook.com/docs/whatsapp/cloud-api).

## Prerequisites

- Meta (Facebook) developer account
- Business verification (required for production; test mode works without)
- Phone number for WhatsApp (can use Meta's test number initially)

## WhatsApp ID Types Reference

WhatsApp Cloud API uses two primary identifiers. Understanding the difference is critical for webhook validation.

| ID Type                                    | Represents                                                 | Primary Use                                                     | Example           |
| ------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------- | ----------------- |
| **WhatsApp Business Account ID (WABA ID)** | The business entity as a whole                             | Webhook subscriptions, business settings, phone number listings | `102290129340398` |
| **Phone Number ID**                        | A specific WhatsApp phone number registered under the WABA | Sending/receiving messages via API, message routing             | `106540352242922` |

**Where they appear in webhook payloads:**

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398", // ← WABA ID
      "changes": [
        {
          "value": {
            "metadata": {
              "phone_number_id": "106540352242922", // ← Phone Number ID
              "display_phone_number": "15550783881"
            }
          }
        }
      ]
    }
  ]
}
```

**IntexuraOS validates both IDs** on incoming webhooks:

- `INTEXURAOS_WHATSAPP_WABA_ID` — must match `entry[].id`
- `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID` — must match `metadata.phone_number_id`

This ensures webhooks are only accepted from your configured business account and phone number.

> **Reference**: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components

## 1. Create/Access Meta Developer Account

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Log in with your Facebook account
3. If first time, accept developer terms and complete onboarding

## 2. Create an App for WhatsApp

1. Go to [My Apps](https://developers.facebook.com/apps/)
2. Click **Create App**
3. Select use case: **Other**
4. Select app type: **Business**
5. Enter app details:
   - **App name**: `Intexura`
   - **App contact email**: Your email
   - **Business Account**: Select existing or create new
6. Click **Create App**

### Add WhatsApp Product

1. From your app dashboard, scroll to **Add products to your app**
2. Find **WhatsApp** and click **Set up**
3. This adds the WhatsApp product to your app

## 3. Create/Connect WhatsApp Business Account (WABA)

### Option A: Create New WABA (Recommended for new setups)

1. In WhatsApp product settings, go to **WhatsApp** → **API Setup**
2. If prompted, click **Create a WhatsApp Business Account**
3. Follow the wizard:
   - Business name
   - Business category
   - Business description
4. Complete business verification (required for production)

### Option B: Connect Existing WABA

1. Go to **WhatsApp** → **API Setup**
2. Click **Select a WhatsApp Business Account**
3. Choose from your existing accounts
4. Grant necessary permissions

### Find Your WABA ID

1. Go to [Business Settings](https://business.facebook.com/settings/)
2. Navigate to **Accounts** → **WhatsApp Business Accounts**
3. Select your account
4. The **WhatsApp Business Account ID** is displayed (format: `1234567890123456`)

## 4. Add a Phone Number

### Test Phone Number (Development)

Meta provides a free test phone number for development:

1. Go to **WhatsApp** → **API Setup**
2. Under **Send and receive messages**, note the **Test phone number**
3. This number can only message numbers added to your **Recipient phone numbers** list
4. Add your personal number to the recipients list for testing

### Production Phone Number

For production, you need a real phone number:

1. Go to **WhatsApp** → **API Setup**
2. Click **Add phone number**
3. Enter a phone number you own (not currently on WhatsApp)
4. Verify via SMS or voice call
5. Complete display name review (takes 24-48 hours)

### Find Your Phone Number ID

1. Go to **WhatsApp** → **API Setup**
2. Under **From**, your phone number is listed
3. Click the dropdown to see the **Phone Number ID** (format: `123456789012345`)

> **Important**: Phone Number ID ≠ phone number. The ID is a Meta identifier.

## 5. Generate Access Token

### Temporary Token (Development Only)

1. Go to **WhatsApp** → **API Setup**
2. Under **Temporary access token**, copy the token
3. This token expires in 24 hours and is for testing only

### Permanent System User Token (Production)

For production, create a System User with a permanent token:

1. Go to [Business Settings](https://business.facebook.com/settings/)
2. Navigate to **Users** → **System users**
3. Click **Add** to create a new system user:
   - Name: `intexuraos-whatsapp-bot`
   - Role: **Admin** (required for messaging)
4. Click **Add Assets**:
   - Select **Apps** → your WhatsApp app
   - Grant **Full control**
   - Select **WhatsApp Accounts** → your WABA
   - Grant **Full control**
5. Click **Generate new token**:
   - Select your app
   - Select permissions:
     - `whatsapp_business_messaging` (required)
     - `whatsapp_business_management` (required)
   - Set expiration: **Never** (for production)
6. Copy and securely store the token immediately (shown only once)

### Security Caveats

- **Never commit tokens to git**
- **Use Secret Manager** in production (see Terraform setup)
- **Rotate tokens** if compromised
- **Limit token scope** to minimum required permissions
- **Monitor usage** via Meta Business Suite analytics

## 6. Set Up Webhooks

Webhooks allow your service to receive incoming messages and status updates.

### Callback URL Concept

You need a publicly accessible HTTPS endpoint that Meta will call. This will be implemented in a future IntexuraOS service. For now, document your planned URL:

```
https://your-service.run.app/webhooks/whatsapp
```

### Configure Webhook in Meta Dashboard

1. Go to **WhatsApp** → **Configuration**
2. Under **Webhook**, click **Edit**
3. Configure:
   - **Callback URL**: Your service endpoint (must be HTTPS)
   - **Verify token**: A secret string you create (e.g., `intexuraos_whatsapp_verify_abc123`)
4. Click **Verify and save**

### Webhook Verification Flow

When you save, Meta sends a GET request to your callback URL:

```
GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=CHALLENGE
```

Your service must:

1. Verify `hub.verify_token` matches your configured token
2. Return the `hub.challenge` value as plain text

### Subscribe to Webhook Fields

After verification, subscribe to message events:

1. Still in **Configuration** → **Webhook**
2. Under **Webhook fields**, click **Manage**
3. Enable:
   - `messages` - Incoming messages, reactions, replies
   - `message_status` - Delivery/read receipts (optional but recommended)

> **Note**: Other fields like `message_template_status_update` are useful for template management.

### REQUIRED: Subscribe the app to your WABA (missing step)

Even when the webhook URL is verified and fields are selected, **message webhooks may not fire** until the WhatsApp app is explicitly subscribed to the WhatsApp Business Account (WABA).

This subscription is **not always done automatically** by the Meta UI.

#### Option A (recommended): Meta Graph API Explorer

1. Open Graph API Explorer:
   - https://developers.facebook.com/tools/explorer/
2. Select:
   - **Meta App**: your WhatsApp app
   - **User token**: a token that has access to the Business/WABA
3. Add required permissions (at minimum):
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
4. Run (replace `${WABA_ID}`):

**Check current subscriptions**

```
GET /v24.0/${WABA_ID}/subscribed_apps
```

**Subscribe your app**

```
POST /v24.0/${WABA_ID}/subscribed_apps
```

If successful, re-run the GET and confirm your `app_id` appears.

#### Option B: curl (same Graph API calls)

```bash
export META_ACCESS_TOKEN="..."  # token with required permissions
export WABA_ID="1234567890123456"

# Check subscriptions
curl -s "https://graph.facebook.com/v24.0/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${META_ACCESS_TOKEN}" \
  | jq .

# Subscribe app
curl -s -X POST "https://graph.facebook.com/v24.0/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${META_ACCESS_TOKEN}" \
  | jq .
```

#### When to do this

Do this

- after creating/connecting the WABA and adding the WhatsApp product to the app
- after configuring the webhook callback + selecting webhook fields
- whenever you rotate the app/WABA relationship, or migrate between test/prod WABAs

#### Symptom this fixes

- Webhook verification works (GET challenge succeeds)
- “Test webhook” in dashboard may work
- Sending/receiving real messages works
- **But incoming `messages` webhooks never arrive**

## 7. Required Permissions/Scopes

| Permission                     | Purpose                         | Required |
| ------------------------------ | ------------------------------- | -------- |
| `whatsapp_business_messaging`  | Send/receive messages           | ✅ Yes   |
| `whatsapp_business_management` | Manage phone numbers, templates | ✅ Yes   |
| `business_management`          | Access business settings        | Optional |

These permissions are selected when generating your System User token.

## 8. Send a Test Message

### Using a Message Template (Required for business-initiated)

First, find or create an approved template:

1. Go to **WhatsApp** → **Message Templates**
2. Use the default `hello_world` template or create your own
3. Note the template name and language code

Send template message via curl:

```bash
# Set your credentials
export WHATSAPP_ACCESS_TOKEN="your-access-token"
export PHONE_NUMBER_ID="your-phone-number-id"
export RECIPIENT_PHONE="+1234567890"  # Include country code

# Send template message
curl -X POST "https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "'"${RECIPIENT_PHONE}"'",
    "type": "template",
    "template": {
      "name": "hello_world",
      "language": { "code": "en_US" }
    }
  }'
```

Expected response:

```json
{
  "messaging_product": "whatsapp",
  "contacts": [{ "input": "+1234567890", "wa_id": "1234567890" }],
  "messages": [{ "id": "wamid.XXXXX" }]
}
```

### Session Message (Reply within 24h window)

After user messages you first (opens 24h window), you can send free-form text:

```bash
curl -X POST "https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "'"${RECIPIENT_PHONE}"'",
    "type": "text",
    "text": { "body": "Hello from IntexuraOS!" }
  }'
```

## 9. Common Failure Modes

### 401 Unauthorized - Invalid Token

**Symptom:**

```json
{
  "error": {
    "message": "Invalid OAuth access token",
    "code": 190
  }
}
```

**Causes:**

- Token expired (temporary tokens last 24h)
- Token was revoked
- Token missing required permissions

**Fix:**

- Generate new token with correct permissions
- Use permanent System User token for production

### 400 Bad Request - Invalid Phone Number

**Symptom:**

```json
{
  "error": {
    "message": "Parameter value is not valid",
    "code": 100
  }
}
```

**Causes:**

- Phone number format incorrect (missing country code)
- Recipient not in test number's allowed list
- Phone number not registered on WhatsApp

**Fix:**

- Use E.164 format: `+[country code][number]`
- Add recipient to test phone number's allowed list
- Verify recipient has WhatsApp installed

### 403 Forbidden - Permissions Issue

**Symptom:**

```json
{
  "error": {
    "message": "(#200) Application does not have permission",
    "code": 200
  }
}
```

**Causes:**

- System User lacks required asset permissions
- App not properly connected to WABA
- Business not verified (for production features)

**Fix:**

- Grant System User access to App and WABA
- Complete business verification
- Check token has `whatsapp_business_messaging` scope

### 131030 - Rate Limit Exceeded

**Symptom:**

```json
{
  "error": {
    "code": 131030,
    "error_subcode": 2494055,
    "message": "Rate limit hit"
  }
}
```

**Causes:**

- Too many messages sent too quickly
- Tier limits exceeded (based on quality rating)

**Fix:**

- Implement exponential backoff
- Check your messaging tier in Business Manager
- Improve message quality to increase tier

### Webhook Not Receiving Events

**Causes:**

- Callback URL not accessible publicly
- SSL certificate invalid
- Verify token mismatch
- Webhook fields not subscribed

**Debug steps:**

1. Test callback URL is reachable: `curl -I https://your-url`
2. Check SSL: `openssl s_client -connect your-domain:443`
3. Verify webhook subscription in Meta dashboard
4. Check subscribed fields are enabled

### 131047 - Message Failed to Send

**Symptom:**

```json
{
  "error": {
    "code": 131047,
    "message": "Message failed to send"
  }
}
```

**Causes:**

- 24h messaging window expired
- Template not approved
- Recipient blocked your number

**Fix:**

- Use approved template for business-initiated messages
- Check template status in Message Templates
- Wait for user to message you first

## Environment Variable Summary

### Local Development (.env)

```bash
# WhatsApp Business Cloud API - Required for whatsapp-service
INTEXURAOS_WHATSAPP_VERIFY_TOKEN=your-webhook-verify-token
INTEXURAOS_WHATSAPP_APP_SECRET=your-app-secret

# Optional: for sending messages (not used by webhook service)
WHATSAPP_ACCESS_TOKEN=your-access-token
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_WABA_ID=1234567890123456
```

### Production (Secret Manager via Terraform)

| Secret Name                           | Env Var                               | Purpose                      |
| ------------------------------------- | ------------------------------------- | ---------------------------- |
| `INTEXURAOS_WHATSAPP_VERIFY_TOKEN`    | `INTEXURAOS_WHATSAPP_VERIFY_TOKEN`    | Webhook verification         |
| `INTEXURAOS_WHATSAPP_APP_SECRET`      | `INTEXURAOS_WHATSAPP_APP_SECRET`      | Webhook signature validation |
| `INTEXURAOS_WHATSAPP_ACCESS_TOKEN`    | `INTEXURAOS_WHATSAPP_ACCESS_TOKEN`    | API authentication           |
| `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID` | `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID` | Identify sender              |
| `INTEXURAOS_WHATSAPP_WABA_ID`         | `INTEXURAOS_WHATSAPP_WABA_ID`         | Business account ID          |

## IntexuraOS WhatsApp Service

The `whatsapp-service` app provides webhook endpoints for receiving WhatsApp events.

### Endpoints

| Method | Path                 | Purpose                           | Auth         |
| ------ | -------------------- | --------------------------------- | ------------ |
| GET    | `/webhooks/whatsapp` | Webhook verification (Meta setup) | Verify token |
| POST   | `/webhooks/whatsapp` | Receive webhook events            | Signature    |
| GET    | `/health`            | Health check                      | None         |

### Webhook Verification Flow

When you configure the webhook URL in Meta's dashboard, Meta sends a GET request:

```
GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=CHALLENGE
```

The service:

1. Validates `hub.verify_token` matches `INTEXURAOS_WHATSAPP_VERIFY_TOKEN`
2. Returns `hub.challenge` as plain text on success
3. Returns 403 if token doesn't match

### Webhook Event Flow

For incoming messages and status updates, Meta sends POST requests:

```
POST /webhooks/whatsapp
X-Hub-Signature-256: sha256=<hex-digest>
Content-Type: application/json
```

The service:

1. Validates `X-Hub-Signature-256` using `INTEXURAOS_WHATSAPP_APP_SECRET`
2. Returns 401 if signature header is missing
3. Returns 403 if signature is invalid
4. Persists valid events to Firestore (`whatsapp_webhook_events` collection)
5. Returns 200 to acknowledge receipt (prevents Meta retries)

### Running Locally

```bash
# From repo root
npm install

# Set required environment variables
export INTEXURAOS_WHATSAPP_VERIFY_TOKEN="your-verify-token"
export INTEXURAOS_WHATSAPP_APP_SECRET="your-app-secret"

# Build and run
npm run build
cd apps/whatsapp-service
npm start
```

### Docker

```bash
# Build
docker build -f apps/whatsapp-service/Dockerfile -t whatsapp-service .

# Run
docker run -p 8080:8080 \
  -e INTEXURAOS_WHATSAPP_VERIFY_TOKEN="your-verify-token" \
  -e INTEXURAOS_WHATSAPP_APP_SECRET="your-app-secret" \
  whatsapp-service
```

### Docker Compose

```bash
# Start all services including whatsapp-service
docker compose -f docker/docker-compose.yaml up --build
```

WhatsApp service is available at `http://localhost:8082`.

## Useful Links

- [WhatsApp Business Platform Overview](https://developers.facebook.com/docs/whatsapp/cloud-api/overview)
- [API Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference)
- [Webhooks Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components)
- [Message Templates](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates)
- [Rate Limits & Quality Rating](https://developers.facebook.com/docs/whatsapp/messaging-limits)
- [Error Codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)

## Security Notes (v1 Sandbox)

- Store all credentials in Secret Manager, never in code
- Use webhook signature validation (`X-Hub-Signature-256`) in production
- Implement rate limiting on your webhook endpoint
- Log message IDs but never message content in production
- Test thoroughly with test phone number before production
