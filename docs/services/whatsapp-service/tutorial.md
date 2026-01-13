# WhatsApp Service - Tutorial

WhatsApp-service has no user-facing tutorial as it's primarily a webhook receiver. See technical documentation for integration details.

## Quick Reference

### Verify Webhook

```bash
curl "https://whatsapp-service.intexuraos.com/whatsapp/webhooks?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=CHALLENGE"
```

Returns challenge as plain text on success.

### List Messages

```bash
curl https://whatsapp-service.intexuraos.com/whatsapp/messages \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Media URL

```bash
curl https://whatsapp-service.intexuraos.com/whatsapp/messages/MESSAGE_ID/media \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Returns signed URL valid for 15 minutes.
