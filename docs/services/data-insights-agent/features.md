# Data Insights Agent

Turn scattered data into actionable insights with AI-powered analysis and automatic chart generation.

## The Problem

Data sits in silos across your digital life -- mobile notifications, custom datasets, and disconnected spreadsheets. Finding patterns requires manual analysis, spreadsheet expertise, and repetitive work. Traditional dashboards need pre-defined metrics and miss insights that emerge organically from your data.

## How It Helps

### Composite Feeds Unify Your Data

Combine multiple data sources into a single feed for analysis. Mix custom datasets with live mobile notifications filtered by app, source, or content.

**Example:** Create a "Sales & Inventory" feed that combines CSV sales data with inventory alerts from your warehouse app. The AI sees both data streams together and identifies correlations you would miss.

### AI Discovers Hidden Patterns

Gemini analyzes your feed and extracts up to 5 measurable, trackable insights with suggested visualizations. No SQL or spreadsheet formulas required.

**Example:** Upload customer support data and get insights like "Response time increases 40% on weekends" with a line chart recommendation.

### Automatic Chart Generation

Get ready-to-use Vega-Lite chart specifications matched to your data type. Six chart types supported: line, bar, scatter, area, pie, and heatmap.

**Example:** An insight about revenue trends gets a line chart with proper time-series encoding. A category comparison gets a bar chart.

### Saved Visualizations for Live Dashboards

Save chart configurations as persistent visualizations that recompute when you refresh the snapshot. Create a visualization once from a chart definition, and when the underlying snapshot data refreshes, your saved charts can be recomputed on demand or via the manual refresh endpoint.

**Example:** Create a revenue trend visualization and pin it to your dashboard. When you refresh the feed snapshot, trigger a visualization refresh to get the latest chart data.

### Snapshots for Fast Performance

Feed data is aggregated into snapshots on feed creation and update, so analysis and chart generation operate against pre-computed data rather than re-fetching every time.

**Example:** After creating a composite feed, the snapshot generates automatically. Subsequent analysis requests read from the snapshot, returning results in seconds instead of re-aggregating all sources.

## Use Case

You are tracking sales data across three sources: a monthly CSV export, inventory alerts from your mobile app, and custom notes about promotions. You create a composite feed with all three sources. The service aggregates the data and generates a snapshot. You click "Analyze" and get 5 insights: one shows seasonal trends (line chart), another compares product categories (bar chart), and a third correlates low inventory with sales spikes (scatter plot). Each insight includes the trackable metric and a ready-to-render chart definition. You save the revenue trend chart as a visualization -- it creates in pending state, computes asynchronously, and transitions to ready with the transformed chart data.

## Key Benefits

- **Zero SQL required** -- AI extracts insights from raw data
- **Multi-source aggregation** -- Combine datasets with live notifications
- **Smart chart recommendations** -- AI picks the best visualization type
- **Persistent visualizations** -- Save charts that can be refreshed on demand
- **Cached snapshots** -- Fast responses on repeated queries
- **Vega-Lite output** -- Charts render anywhere the spec is supported

## Limitations

- **Text-based data only** -- Binary formats (images, PDFs) not supported
- **LLM API key required** -- Analysis needs a configured Gemini or Zai key
- **Max 5 insights per feed** -- Keeps analysis focused and actionable
- **5 static sources per feed** -- Ensures performance on large datasets
- **3 notification filters per feed** -- Limits query complexity
- **10 visualizations per feed** -- Maximum saved charts per composite feed
- **No scheduled refresh** -- Snapshots refresh on feed creation/update and on-demand only

---

_Part of [IntexuraOS](../overview.md) -- Turn data into insights, not spreadsheets._
