# Data Insights Agent

AI-powered data analysis - upload datasets, generate visualizations, and create composite data feeds using Gemini.

## The Problem

Users need insights from data without manual analysis:

1. **Data upload** - Store and manage custom datasets
2. **AI analysis** - Extract insights from unstructured data
3. **Visualization** - Generate charts and graphs automatically
4. **Composite feeds** - Combine multiple data sources

## How It Helps

Data-insights-agent provides end-to-end data analysis:

1. **Data sources** - CRUD for custom datasets (title, content)
2. **Title generation** - AI-generated titles using Gemini
3. **Data analysis** - Extract insights with LLM
4. **Chart definitions** - Auto-generate chart configurations
5. **Composite feeds** - Combine multiple sources into unified feeds
6. **Snapshots** - Cached analysis results for performance

## Key Features

**Data Source Management:**

- Create, read, update, delete custom data sources
- Title auto-generation with Gemini
- Content validation and storage

**Analysis Capabilities:**

- Natural language data queries
- Chart type detection (bar, line, pie, scatter)
- Data transformation for preview

**Composite Feeds:**

- Combine multiple data sources
- Feed name generation
- Mobile notifications for updates

## Use Cases

### Create and analyze data

1. User uploads CSV content as data source
2. Generate AI title: "Q1 Sales Data"
3. Request analysis: "What are the trends?"
4. Receive insights and chart definition

### Composite feed creation

1. User selects multiple data sources
2. Creates composite feed
3. Receives unified insights across sources
4. Gets notified on updates

## Key Benefits

**AI-powered insights** - Gemini extracts patterns without SQL

**Auto-visualization** - Chart definitions generated automatically

**Multi-source** - Composite feeds combine datasets

**Cached snapshots** - Fast response on repeated queries

**Mobile notifications** - Updates pushed to devices

## Limitations

**Text-only data** - Binary formats not supported

**Google API required** - Analysis requires Gemini API key

**Size limits** - Large datasets may timeout

**No real-time** - Snapshot-based, not streaming

**No export** - Results can't be exported to CSV/Excel
