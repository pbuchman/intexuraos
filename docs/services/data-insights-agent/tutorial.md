# Data Insights Agent — Tutorial

> **Time:** 20-30 minutes
> **Prerequisites:** Node.js 22+, Auth0 access token, configured LLM API key
> **You'll learn:** Create data sources, build composite feeds, analyze data with AI, and generate charts

---

## What You'll Build

A complete data analysis workflow:

- Custom data source with AI-generated title
- Composite feed combining multiple sources
- AI-powered data insights with chart recommendations
- Ready-to-render Vega-Lite chart specifications

---

## Prerequisites

Before starting, ensure you have:

- [ ] Auth0 access token for the IntexuraOS API
- [ ] LLM API key configured in user-service settings
- [ ] Sample data in CSV or JSON format

---

## Part 1: Create Your First Data Source (5 minutes)

Let's start by storing some data to analyze.

### Step 1.1: Create a Data Source

```bash
curl -X POST https://intexuraos-data-insights-agent-cj44trunra-lm.a.run.app/data-sources \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q1 Sales Data",
    "content": "month,revenue,expenses,profit\nJan,50000,30000,20000\nFeb,55000,32000,23000\nMar,60000,35000,25000"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "ds-abc123",
    "userId": "user-xyz",
    "title": "Q1 Sales Data",
    "content": "month,revenue,expenses,profit\nJan,50000,30000,20000...",
    "createdAt": "2025-01-25T10:00:00Z",
    "updatedAt": "2025-01-25T10:00:00Z"
  },
  "diagnostics": {
    "requestId": "req-123",
    "durationMs": 45
  }
}
```

### What Just Happened?

Your data was stored in Firestore and assigned a unique ID. Save the `id` from the response — you'll need it to create composite feeds.

---

## Part 2: Generate an AI Title (3 minutes)

Let the AI create a descriptive title from raw content.

### Step 2.1: Request Title Generation

```bash
curl -X POST https://intexuraos-data-insights-agent-cj44trunra-lm.a.run.app/data-sources/generate-title \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "January: 50 sales, February: 65 sales, March: 72 sales. Product A outselling B by 2x."
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "title": "Q1 Sales Performance Report"
  }
}
```

### What Just Happened?

The LLM analyzed your content and generated a concise, descriptive title. Use this when creating data sources to keep naming consistent.

---

## Part 3: Create a Composite Feed (7 minutes)

Combine multiple data sources and notification filters into a unified feed.

### Step 3.1: Create the Feed

```bash
curl -X POST https://intexuraos-data-insights-agent-cj44trunra-lm.a.run.app/composite-feeds \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "purpose": "Track monthly sales performance and inventory alerts",
    "staticSourceIds": ["ds-abc123"],
    "notificationFilters": [
      {
        "name": "Inventory Alerts",
        "app": ["com.warehouse.app"],
        "source": "inventory-system"
      }
    ]
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "feed-xyz789",
    "name": "Sales & Inventory Tracker",
    "purpose": "Track monthly sales performance and inventory alerts",
    "staticSourceIds": ["ds-abc123"],
    "notificationFilters": [...],
    "createdAt": "2025-01-25T10:05:00Z"
  }
}
```

### What Just Happened?

1. The feed was created with your data sources
2. The LLM generated a descriptive name: "Sales & Inventory Tracker"
3. A background job started to fetch matching notifications
4. A snapshot was created for fast analysis

**Checkpoint:** You should have a feed ID. Save it for the next steps.

---

## Part 4: Analyze Data with AI (5 minutes)

Extract insights from your composite feed.

### Step 4.1: Request Analysis

```bash
curl -X POST https://intexuraos-data-insights-agent-cj44trunra-lm.a.run.app/composite-feeds/feed-xyz789/analyze \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "insights": [
      {
        "id": "feed-xyz789-insight-1",
        "title": "Revenue Growth Trend",
        "description": "Revenue increased by 20% from January to March, with profit margins improving steadily.",
        "trackableMetric": "Monthly revenue growth rate",
        "suggestedChartType": "C1",
        "generatedAt": "2025-01-25T10:10:00Z"
      },
      {
        "id": "feed-xyz789-insight-2",
        "title": "Expense Ratio Analysis",
        "description": "Expenses consistently represent 60% of revenue, suggesting stable operational costs.",
        "trackableMetric": "Expense-to-revenue ratio",
        "suggestedChartType": "C2",
        "generatedAt": "2025-01-25T10:10:00Z"
      }
    ]
  }
}
```

### What Just Happened?

The AI analyzed your snapshot data and identified:

- **Measurable patterns** (revenue growth, expense ratios)
- **Trackable metrics** for ongoing monitoring
- **Chart type recommendations** (C1 = line chart, C2 = bar chart)

**Chart Types Reference:**

| Code | Type         | Best For                       |
| ---- | ------------ | ------------------------------ |
| C1   | Line Chart   | Trends over time               |
| C2   | Bar Chart    | Comparing categories           |
| C3   | Scatter Plot | Correlations between variables |
| C4   | Area Chart   | Cumulative totals              |
| C5   | Pie Chart    | Part-to-whole percentages      |
| C6   | Heatmap      | Density and matrix data        |

---

## Part 5: Generate a Chart Definition (5 minutes)

Get a Vega-Lite specification for rendering the chart.

### Step 5.1: Request Chart Definition

```bash
curl -X POST https://intexuraos-data-insights-agent-cj44trunra-lm.a.run.app/composite-feeds/feed-xyz789/insights/feed-xyz789-insight-1/chart-definition \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "vegaLiteConfig": {
      "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
      "mark": "line",
      "encoding": {
        "x": {
          "field": "month",
          "type": "temporal",
          "title": "Month"
        },
        "y": {
          "field": "revenue",
          "type": "quantitative",
          "title": "Revenue ($)"
        }
      }
    },
    "dataTransformInstructions": "Extract month and revenue fields. Sort by month chronologically."
  }
}
```

### What Just Happened?

The LLM generated a complete Vega-Lite specification based on:

- Your data structure
- The insight type (trend analysis)
- The recommended chart type (line chart)

You can now pass this spec directly to any Vega-Lite renderer.

---

## Troubleshooting

| Problem                 | Solution                                                  |
| ----------------------- | --------------------------------------------------------- |
| "MISCONFIGURED"         | Configure your LLM API key in user-service settings first |
| 409 Conflict            | Data source is used by a composite feed — remove it first |
| "No insights generated" | Your data may not have enough patterns — add more data    |
| "Snapshot not found"    | Wait for snapshot generation (up to 30 seconds)           |
| "UNAUTHORIZED"          | Verify your Auth0 token is valid and not expired          |

---

## Next Steps

Now that you understand the basics:

1. **Add more data sources** — Combine CSV exports with live notifications
2. **Explore chart types** — Try different visualizations for your insights
3. **Set up scheduled refreshes** — Configure Cloud Scheduler for automatic snapshots
4. **Read the [Technical Reference](technical.md)** for full API details

---

## Exercises

Test your understanding:

1. **Easy:** Create a data source with JSON content instead of CSV
2. **Medium:** Create a composite feed with 2 notification filters
3. **Hard:** Use the preview endpoint to transform data for a custom chart

<details>
<summary>Solutions</summary>

### Exercise 1: JSON Data Source

```bash
curl -X POST https://intexuraos-data-insights-agent-cj44trunra-lm.a.run.app/data-sources \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Website Traffic",
    "content": "{\"page\":\"/home\",\"visitors\":1200},{\"page\":\"/about\",\"visitors\":800}"
  }'
```

### Exercise 2: Multiple Notification Filters

```bash
curl -X POST https://intexuraos-data-insights-agent-cj44trunra-lm.a.run.app/composite-feeds \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "purpose": "Track sales and support tickets",
    "staticSourceIds": ["ds-abc123"],
    "notificationFilters": [
      {
        "name": "Sales Alerts",
        "app": ["com.sales.app"],
        "source": "crm"
      },
      {
        "name": "Support Tickets",
        "title": "urgent"
      }
    ]
  }'
```

### Exercise 3: Chart Preview

```bash
curl -X POST https://intexuraos-data-insights-agent-cj44trunra-lm.a.run.app/composite-feeds/feed-xyz789/preview \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chartConfig": {
      "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
      "mark": "bar",
      "encoding": {
        "x": {"field": "category", "type": "nominal"},
        "y": {"field": "value", "type": "quantitative"}
      }
    },
    "transformInstructions": "Group by category and sum values",
    "insightId": "feed-xyz789-insight-2"
  }'
```

</details>
