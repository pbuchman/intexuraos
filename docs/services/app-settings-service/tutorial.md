# App Settings Service - Tutorial

LLM pricing and usage tracking.

## Prerequisites

- Auth0 access token

## Part 1: Get Pricing

```bash
curl -X GET https://app-settings.intexuraos.com/settings/pricing \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:** All provider pricing with per-model costs.

## Part 2: Get Usage Costs

```bash
curl -X GET "https://app-settings.intexuraos.com/settings/usage-costs?days=30" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:** Personal usage statistics with monthly and model breakdowns.

## Troubleshooting

| Error      | Cause                | Solution      |
| ---------- | -------------------- | ------------- |
| days > 365 | Invalid range        | Use 1-365     |
| 500        | Missing pricing data | Contact admin |
