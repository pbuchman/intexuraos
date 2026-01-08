# Send WhatsApp Message

Send a WhatsApp message from the command line.

## Direct API (Simplest)

Send directly via WhatsApp Business API:

```bash
curl -s -X POST "https://graph.facebook.com/v22.0/${INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${INTEXURAOS_WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"messaging_product\": \"whatsapp\",
    \"to\": \"${INTEXURAOS_MY_PHONE_NUMBER}\",
    \"type\": \"text\",
    \"text\": { \"body\": \"Your message here\" }
  }"
```

**Important:** Use this exact minimal payload format. Do NOT add extra fields like `recipient_type` or `preview_url` - they can cause delivery issues even when the API returns success.

## Via Internal Service (For Production)

```bash
# Replace MESSAGE with your text
curl -s -X POST "${INTEXURAOS_WHATSAPP_SERVICE_URL}/internal/whatsapp/pubsub/send-message" \
  -H "x-internal-auth: ${INTEXURAOS_INTERNAL_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"data\": \"$(echo -n '{\"type\":\"whatsapp.message.send\",\"userId\":\"${INTEXURAOS_USER_ID}\",\"message\":\"MESSAGE\",\"correlationId\":\"claude-'$(date +%s)'\"}' | base64)\",
      \"messageId\": \"claude-$(date +%s)\",
      \"publishTime\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    },
    \"subscription\": \"manual\"
  }"
```

## Helper Function

Add to your shell profile for easy messaging:

```bash
send-whatsapp() {
  local message="$1"
  local user_id="${INTEXURAOS_USER_ID}"

  if [ -z "$message" ]; then
    echo "Usage: send-whatsapp 'Your message here'"
    return 1
  fi

  local event=$(cat <<EOF
{"type":"whatsapp.message.send","userId":"${user_id}","message":"${message}","correlationId":"claude-$(date +%s)"}
EOF
)

  curl -s -X POST "${INTEXURAOS_WHATSAPP_SERVICE_URL}/internal/whatsapp/pubsub/send-message" \
    -H "x-internal-auth: ${INTEXURAOS_INTERNAL_AUTH_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"message\": {
        \"data\": \"$(echo -n "$event" | base64)\",
        \"messageId\": \"claude-$(date +%s)\",
        \"publishTime\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
      },
      \"subscription\": \"manual\"
    }"
}
```

## Required Environment Variables

| Variable                              | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `INTEXURAOS_MY_PHONE_NUMBER`          | Your phone number (without +)                  |
| `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone ID                     |
| `INTEXURAOS_WHATSAPP_ACCESS_TOKEN`    | Meta Graph API token                           |
| `INTEXURAOS_USER_ID`                  | Your IntexuraOS user ID (for internal service) |

All variables are set in `.envrc.local` (persists through `sync-secrets.sh`).

## Event Payload Structure

The base64-encoded event payload:

```json
{
  "type": "whatsapp.message.send",
  "userId": "auth0|abc123",
  "message": "Hello from Claude!",
  "correlationId": "optional-trace-id",
  "replyToMessageId": "optional-wamid.xxx"
}
```

## Response

**Success:**

```json
{ "success": true }
```

**Error:**

```json
{ "error": "User not connected to WhatsApp" }
```

## Troubleshooting

| Error                       | Cause                       | Fix                                                      |
| --------------------------- | --------------------------- | -------------------------------------------------------- |
| 401 Unauthorized            | Invalid/missing auth token  | Check `INTEXURAOS_INTERNAL_AUTH_TOKEN`                   |
| User not connected          | User hasn't linked WhatsApp | Connect via web app Settings → WhatsApp                  |
| Connection refused          | Service not running         | Start whatsapp-service locally                           |
| API success but no delivery | Extra fields in payload     | Use minimal payload (no `recipient_type`, `preview_url`) |
