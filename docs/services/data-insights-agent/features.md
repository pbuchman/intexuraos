# Data Insights Agent

Your data, visualized. Feed it anything — CSV exports, text files, live notifications — and the AI finds the patterns, picks the charts, and keeps them current.

## The Problem

Data accumulates faster than anyone can analyze it. Sales figures arrive in a CSV. Inventory alerts ping your phone. Customer feedback sits in a text file. Each source tells part of the story, but no single view connects them. To find the pattern that matters — the one that links a spike in support tickets to a drop in inventory — you would need to export, clean, merge, and chart the data yourself. That means spreadsheets, formulas, pivot tables, and hours of manual work before you see a single insight.

Most people never get that far. The data sits in its silos, and the patterns stay hidden.

## Use Case: From Scattered Data to a Living Dashboard

You run a small online store. Sales data lives in a monthly CSV export. Inventory alerts arrive as push notifications on your phone. Promotional notes sit in a text file you update by hand.

You upload all three as data sources. Then you create a composite feed called "Store Performance" — the AI names it for you — combining the three uploads with filtered mobile notifications from your inventory app. You describe the feed's purpose: "Track how promotions affect sales and stock levels."

You tap Analyze. Within seconds, the AI returns five insights: a seasonal revenue trend best shown as a line chart, a product category comparison suited to a bar chart, a correlation between low stock and sales spikes rendered as a scatter plot, a breakdown of promotional impact as a pie chart, and a daily order volume pattern displayed as a heatmap.

Each insight carries a trackable metric and a recommended visualization. You preview the revenue trend chart, confirm it looks right, and save it. No formulas, no spreadsheet gymnastics.

Next week, when you check your dashboard, you tap refresh and the chart pulls your latest sales figures and inventory alerts — current data in seconds, not hours of manual rework.

## How It Helps

### Composite Feeds Unify Your Data

Create a single feed that combines up to five static data sources — CSV, JSON, or plain text — with filtered mobile notifications. Notification filters let you select by app, source, or title keyword, so only the alerts that matter flow into your analysis. Every feed gets an AI-generated name and a user-defined purpose that guides the analysis.

### AI Discovers What You Would Miss

Point the AI at a composite feed and it returns up to five measurable, trackable insights. Each insight comes with a title, a description, a metric you can follow over time, and a recommended chart type drawn from six options: line, bar, scatter, area, pie, and heatmap. If the data does not support meaningful insights, the system tells you why instead of returning empty results.

### Preview Before You Commit

Before saving a visualization, you can preview it. The system generates a chart configuration and transforms your data so you see exactly what the final chart will look like. Nothing is saved until you decide it is worth keeping.

### Saved Visualizations That Stay Current

Save up to ten visualizations per feed. Each one is computed asynchronously — the system returns immediately and you check back when it is ready. Once saved, you can trigger a refresh whenever you want the latest view, pulling in the most recent data from the underlying feed.

### Data Sources Are Protected

If a data source is part of an active composite feed, it cannot be deleted. The system tells you which feeds depend on it, preventing accidental data loss.

## Key Benefits

- **No SQL, no formulas** — AI extracts insights directly from raw, unstructured data
- **Multi-source analysis** — Combine custom uploads with live mobile notifications in a single feed
- **Six chart types** — Line, bar, scatter, area, pie, and heatmap, matched automatically to your data
- **Persistent dashboards** — Saved visualizations stay current with a single tap to refresh
- **AI-generated names** — Feed titles created automatically so you spend time analyzing, not labeling
- **Safe data management** — Delete protection ensures active feeds never lose their underlying sources
- **Works with your keys** — Analysis runs on your own LLM API keys, with a platform fallback available

## Limitations

- **Text-based data only** — Images, PDFs, and binary files are not supported as data sources
- **LLM API key recommended** — Full analysis requires a configured API key; a platform fallback covers basic use
- **Up to 5 insights per analysis** — Each feed analysis returns a maximum of five insights to keep results focused
- **Up to 5 data sources per feed** — Composite feeds accept a maximum of five static sources
- **Up to 10 visualizations per feed** — Each feed supports a maximum of ten saved visualizations
- **Manual refresh, not real-time** — Visualizations update when you trigger a refresh, not via continuous streaming
- **No export** — Charts cannot yet be exported to CSV, image, or external tools

---

_Part of [IntexuraOS](../overview.md) — Turn data into insight, not spreadsheets._
