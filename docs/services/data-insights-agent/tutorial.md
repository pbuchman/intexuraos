# Data Insights Agent - Tutorial

AI-powered data analysis service.

## Prerequisites

- Auth0 access token
- Google API key configured in user-service
- Data in CSV or JSON format

## Part 1: Create Data Source

```bash
curl -X POST https://data-insights.intexuraos.com/data-sources \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Sales Data 2024",
    "content": "month,revenue,expenses\nJan,50000,30000\nFeb,55000,32000"
  }'
```

## Part 2: Generate Title

Let AI create a title from content:

```bash
curl -X POST https://data-insights.intexuraos.com/data-sources/generate-title \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "January sales: $50k, February: $55k"
  }'
```

## Troubleshooting

| Error          | Cause              | Solution                          |
| -------------- | ------------------ | --------------------------------- |
| MISCONFIGURED  | No Google API key  | Configure in user-service         |
| CONFLICT (409) | Data source in use | Remove from composite feeds first |
