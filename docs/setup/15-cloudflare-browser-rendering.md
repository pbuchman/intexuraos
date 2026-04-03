# Cloudflare Browser Rendering Setup Guide

This guide walks through setting up Cloudflare Browser Rendering for IntexuraOS page content extraction. It assumes you are starting from scratch with no existing Cloudflare account.

## Prerequisites

- A valid email address for Cloudflare account registration
- Access to the IntexuraOS `.envrc` file (for storing secrets)
- Access to GCP Secret Manager (for production secret storage)

## Step 1: Create a Cloudflare Account

1. Go to [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Enter your email and password
3. Verify your email address
4. Complete account setup (no domain registration required for API-only usage)

## Step 2: Enable Workers & Browser Rendering

Browser Rendering is part of Cloudflare Workers. The free tier includes 10 minutes of browser rendering time per day.

1. In the Cloudflare dashboard, navigate to **Workers & Pages** in the left sidebar
2. If prompted, set up a Workers subdomain (e.g., `intexuraos.workers.dev`)
3. Browser Rendering is automatically available -- no explicit activation needed for REST API usage

## Step 3: Find Your Account ID

1. In the Cloudflare dashboard, click on any domain or go to the **Overview** page
2. Your **Account ID** is displayed in the right sidebar under "API"
3. Alternatively, it's in the dashboard URL: `https://dash.cloudflare.com/{account_id}/...`
4. Copy this value -- it will be stored as `INTEXURAOS_CLOUDFLARE_ACCOUNT_ID`

## Step 4: Create an API Token

1. Go to **My Profile** (top-right avatar menu) > **API Tokens**
2. Click **Create Token**
3. Select **Create Custom Token**
4. Configure the token:
   - **Token name:** `IntexuraOS Browser Rendering`
   - **Permissions:**
     - Account > Browser Rendering > **Edit**
   - **Account Resources:**
     - Include > Your account
   - **Client IP Address Filtering:** (optional) restrict to your server IPs
   - **TTL:** (optional) set an expiry if desired
5. Click **Continue to summary** > **Create Token**
6. **Copy the token immediately** -- it is shown only once
7. This value will be stored as `INTEXURAOS_CLOUDFLARE_API_TOKEN`

## Step 5: Configure IntexuraOS

### Development Environment (.envrc)

Add to your `.envrc` file:

```bash
export INTEXURAOS_CLOUDFLARE_ACCOUNT_ID="your-account-id-here"
export INTEXURAOS_CLOUDFLARE_API_TOKEN="your-api-token-here"
```

Then reload: `direnv allow`

### Production Environment (GCP Secret Manager)

The secrets are managed via Terraform. After running `terraform apply`, populate the secrets:

```bash
echo -n "your-account-id" | gcloud secrets versions add INTEXURAOS_CLOUDFLARE_ACCOUNT_ID \
  --project=intexuraos-dev-pbuchman --data-file=-

echo -n "your-api-token" | gcloud secrets versions add INTEXURAOS_CLOUDFLARE_API_TOKEN \
  --project=intexuraos-dev-pbuchman --data-file=-
```

### Remove Old Crawl4AI Secret

After verifying Cloudflare is working, remove the old secret:

```bash
# Remove from .envrc
# Delete the INTEXURAOS_CRAWL4AI_APP_API_KEY line

# Production cleanup (optional -- Terraform handles this)
gcloud secrets delete INTEXURAOS_CRAWL4AI_APP_API_KEY \
  --project=intexuraos-dev-pbuchman --quiet
```

## Step 6: Verify Integration

Test the endpoint manually:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${INTEXURAOS_CLOUDFLARE_ACCOUNT_ID}/browser-rendering/markdown" \
  -H "Authorization: Bearer ${INTEXURAOS_CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' | jq .
```

Expected response:
```json
{
  "success": true,
  "errors": [],
  "messages": [],
  "result": "# Example Domain\n\nThis domain is for use in illustrative examples..."
}
```

## Rate Limits

| Tier          | Browser Time/Day        | API Requests/Min   | Concurrent Browsers |
| ------------- | ----------------------- | ------------------ | ------------------- |
| Free          | 10 minutes              | 6                  | 3                   |
| Paid ($5+/mo) | Unlimited (usage-based) | 600                | 30                  |

The free tier supports approximately 60-120 page extractions per day (at ~5-10 seconds each). Monitor usage in the Cloudflare dashboard under **Workers & Pages > Browser Rendering**.

## Troubleshooting

| Error            | Cause                                         | Fix                                             |
| ---------------- | --------------------------------------------- | ----------------------------------------------- |
| HTTP 401         | Invalid or expired API token                  | Regenerate token in Cloudflare dashboard        |
| HTTP 403         | Missing "Browser Rendering - Edit" permission | Edit token to add the permission                |
| HTTP 429         | Rate limit exceeded                           | Wait and retry; consider upgrading to paid tier |
| `success: false` | Target page blocks headless browsers          | Expected for some sites; not fixable            |
