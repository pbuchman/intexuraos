# data-insights-agent -- Agent Interface

> **Machine-readable specification for AI agent integration**

---

## Identity

| Attribute | Value                                                          |
| --------- | -------------------------------------------------------------- |
| Name      | data-insights-agent                                            |
| Role      | AI-powered data analysis and visualization service             |
| Goal      | Analyze composite data feeds and generate insights with charts |

---

## Capabilities

### Create Data Source

**Endpoint:** `POST /data-sources`

**When to use:** Store custom data (CSV, JSON, text) for inclusion in composite feeds

**Input Schema:**

```typescript
interface CreateDataSourceInput {
  title: string;   // max 200 chars
  content: string; // max 60,000 chars
}
```

**Output Schema:**

```typescript
interface DataSource {
  id: string;
  userId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
```

**Example:**

```json
// Request
{
  "title": "Q1 Sales Data",
  "content": "month,revenue,expenses\nJan,50000,30000\nFeb,55000,32000"
}

// Response
{
  "success": true,
  "data": {
    "id": "ds-abc123",
    "title": "Q1 Sales Data",
    "content": "month,revenue,expenses\nJan,50000,30000...",
    "createdAt": "2026-02-22T10:00:00Z",
    "updatedAt": "2026-02-22T10:00:00Z"
  }
}
```

### Generate Title

**Endpoint:** `POST /data-sources/generate-title`

**When to use:** Auto-generate descriptive title from data content before creating a data source

**Input Schema:**

```typescript
interface GenerateTitleInput {
  content: string;
}
```

**Output Schema:**

```typescript
interface GenerateTitleOutput {
  title: string;
}
```

### Create Composite Feed

**Endpoint:** `POST /composite-feeds`

**When to use:** Combine data sources and notification filters for unified analysis. Triggers snapshot generation automatically.

**Input Schema:**

```typescript
interface CreateCompositeFeedInput {
  purpose: string;                         // max 1000 chars
  staticSourceIds: string[];               // max 5
  notificationFilters: NotificationFilter[]; // max 3
}

interface NotificationFilter {
  name: string;
  app?: string[];   // multi-select app filter
  source?: string;  // single-select source filter
  title?: string;   // title substring match
}
```

**Output Schema:**

```typescript
interface CompositeFeed {
  id: string;
  userId: string;
  name: string; // AI-generated
  purpose: string;
  staticSourceIds: string[];
  notificationFilters: NotificationFilter[];
  dataInsights: DataInsight[] | null;
  createdAt: string;
  updatedAt: string;
}
```

### Analyze Composite Feed

**Endpoint:** `POST /composite-feeds/{feedId}/analyze`

**When to use:** Extract AI-powered insights from feed snapshot data. Requires existing snapshot (created on feed creation/update).

**Output Schema:**

```typescript
interface AnalyzeFeedOutput {
  insights: DataInsight[];
  noInsightsReason?: string;
}

interface DataInsight {
  id: string;
  title: string;
  description: string;
  trackableMetric: string;
  suggestedChartType: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6';
  generatedAt: string;
}
```

**Example:**

```json
{
  "success": true,
  "data": {
    "insights": [
      {
        "id": "feed-xyz-insight-1",
        "title": "Revenue Growth Trend",
        "description": "Revenue increased 20% from January to March",
        "trackableMetric": "Monthly revenue growth rate",
        "suggestedChartType": "C1",
        "generatedAt": "2026-02-22T10:10:00Z"
      }
    ]
  }
}
```

### Generate Chart Definition

**Endpoint:** `POST /composite-feeds/{feedId}/insights/{insightId}/chart-definition`

**When to use:** Get Vega-Lite spec and transform instructions for rendering a chart. Ephemeral, not persisted.

**Output Schema:**

```typescript
interface ChartDefinitionOutput {
  vegaLiteConfig: object; // Vega-Lite spec without data
  dataTransformInstructions: string;
}
```

**Example:**

```json
{
  "success": true,
  "data": {
    "vegaLiteConfig": {
      "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
      "mark": "line",
      "encoding": {
        "x": { "field": "month", "type": "temporal" },
        "y": { "field": "revenue", "type": "quantitative" }
      }
    },
    "dataTransformInstructions": "Extract month and revenue. Sort chronologically."
  }
}
```

### Preview Chart

**Endpoint:** `POST /composite-feeds/{feedId}/preview`

**When to use:** Transform snapshot data for one-time chart rendering without persisting

**Input Schema:**

```typescript
interface PreviewInput {
  chartConfig: object;
  transformInstructions: string;
  insightId: string;
}
```

**Output Schema:**

```typescript
interface PreviewOutput {
  chartData: object[]; // may be empty array when zero rows match
}
```

### Get Snapshot

**Endpoint:** `GET /composite-feeds/{feedId}/snapshot`

**When to use:** Retrieve cached feed data. Use `?refresh=true` to force re-generation.

**Output Schema:**

```typescript
interface Snapshot {
  feedId: string;
  feedName: string;
  purpose: string;
  generatedAt: string;
  expiresAt: string;
  staticSources: { id: string; name: string; content: string }[];
  notifications: {
    filterId: string;
    filterName: string;
    criteria: { app?: string[]; source?: string; title?: string };
    items: { id: string; app: string; title: string; body: string; timestamp: string; source?: string }[];
  }[];
}
```

### Create Visualization

**Endpoint:** `POST /visualizations`

**When to use:** Save a chart configuration that persists and can be refreshed on demand

**Input Schema:**

```typescript
interface CreateVisualizationInput {
  feedId: string;
  insightId: string;
  chartConfig: object;          // Vega-Lite spec without data
  transformInstructions: string;
}
```

**Output Schema:**

```typescript
type VisualizationStatus = 'pending' | 'ready' | 'refreshing' | 'error';

interface Visualization {
  id: string;
  userId: string;
  feedId: string;
  feedName: string;
  insightId: string;
  insightTitle: string;
  trackableMetric: string;
  chartConfig: object;
  transformInstructions: string;
  chartData: object[] | null;
  status: VisualizationStatus;
  lastError?: string;
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

**Note:** Returns 201 immediately with `status: pending`. Poll `GET /visualizations/:id` until `status: ready` or `error`.

### List Visualizations

**Endpoint:** `GET /visualizations`

**When to use:** Retrieve all saved visualizations for the authenticated user

### Get Visualization

**Endpoint:** `GET /visualizations/{id}`

**When to use:** Poll for computation status or get current chart data

### Delete Visualization

**Endpoint:** `DELETE /visualizations/{id}`

**When to use:** Remove a saved visualization

### Refresh Visualization

**Endpoint:** `POST /visualizations/{id}/refresh`

**When to use:** Manually trigger chart data recomputation against current snapshot

**Note:** Idempotent when already `refreshing` -- returns current state without queuing duplicate computation.

---

## Constraints

**Do NOT:**

- Exceed 5 static sources per composite feed
- Exceed 3 notification filters per composite feed
- Exceed 10 visualizations per composite feed
- Access data sources owned by other users
- Call analyze before a snapshot exists (created on feed creation)
- Create visualizations before analyzing the feed (requires insights)

**Requires:**

- Valid Auth0 bearer token for all public requests
- Configured LLM API key in user-service for analysis operations
- Existing snapshot before analysis (created automatically on feed creation/update)
- Analyzed feed (with insights) before creating visualizations

---

## Usage Patterns

### Pattern 1: End-to-End Analysis Workflow

```
1. POST /data-sources - Store custom data
2. POST /composite-feeds - Create feed with sources + filters (auto-creates snapshot)
3. POST /composite-feeds/:id/analyze - Extract insights
4. POST /composite-feeds/:id/insights/:insightId/chart-definition - Get chart spec
5. POST /composite-feeds/:id/preview - Get transformed chart data (ephemeral)
```

### Pattern 2: Persistent Visualization Workflow

```
1. POST /data-sources - Store custom data
2. POST /composite-feeds - Create feed (auto-creates snapshot)
3. POST /composite-feeds/:id/analyze - Extract insights
4. POST /composite-feeds/:id/insights/:insightId/chart-definition - Get spec + instructions
5. POST /visualizations - Save as persistent visualization (returns pending)
6. GET /visualizations/:id - Poll until status: ready
7. (On-demand) GET /composite-feeds/:id/snapshot?refresh=true then POST /visualizations/:id/refresh
```

### Pattern 3: Data Source Management

```
1. POST /data-sources/generate-title - Get AI title for content
2. POST /data-sources - Create with generated title
3. PUT /data-sources/:id - Update content
4. DELETE /data-sources/:id - Remove (fails if used by feeds)
```

---

## Error Handling

| Error Code         | Meaning                                  | Recovery Action                   |
| ------------------ | ---------------------------------------- | --------------------------------- |
| `NOT_FOUND`        | Feed, source, visualization, or snapshot | Verify ID exists                  |
| `CONFLICT`         | Data source used by composite feeds      | Remove from feeds before deleting |
| `MISCONFIGURED`    | LLM API key not configured               | Configure API key in user-service |
| `VALIDATION_ERROR` | Invalid request input                    | Fix request payload               |
| `NO_API_KEY`       | User LLM key missing                     | Configure API key in user-service |
| `GENERATION_ERROR` | LLM generation failed                    | Retry or check API key quota      |
| `PARSE_ERROR`      | LLM response parsing failed              | Automatically retries with repair |
| `INVALID_REQUEST`  | Limit exceeded (e.g., 10 viz per feed)   | Delete unused items first         |
| `INTERNAL_ERROR`   | Server-side error                        | Retry with backoff                |

---

## Chart Types Reference

| Code | Name         | Mark    | Best For                         |
| ---- | ------------ | ------- | -------------------------------- |
| C1   | Line Chart   | `line`  | Time-series trends               |
| C2   | Bar Chart    | `bar`   | Category comparison              |
| C3   | Scatter Plot | `point` | Correlation analysis             |
| C4   | Area Chart   | `area`  | Cumulative trends                |
| C5   | Pie Chart    | `arc`   | Part-to-whole composition        |
| C6   | Heatmap      | `rect`  | Density patterns and matrix data |

---

## Dependencies

| Service                      | Why Needed                                        |
| ---------------------------- | ------------------------------------------------- |
| user-service                 | Get user's LLM API key                            |
| mobile-notifications-service | Query filtered notifications for feeds            |
| app-settings-service         | LLM pricing data (fetched at startup)             |
| Firestore                    | Persist feeds, sources, snapshots, visualizations |
| LLM Providers (Gemini, Zai)  | Data analysis, title/chart generation, transform  |

---

**Last updated:** 2026-03-07
