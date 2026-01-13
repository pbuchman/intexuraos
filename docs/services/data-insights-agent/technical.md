# Data Insights Agent - Technical Reference

## Overview

Data-insights-agent manages user data sources, performs AI analysis using Gemini, generates chart definitions, and creates composite data feeds. Uses Firestore for persistence.

## API Endpoints

### Data Sources

| Method   | Path                           | Description              | Auth         |
| --------  | ------------------------------  | ------------------------  | ------------  |
| POST     | `/data-sources`                | Create data source       | Bearer token |
| GET      | `/data-sources`                | List user's data sources | Bearer token |
| GET      | `/data-sources/:id`            | Get specific data source | Bearer token |
| PUT      | `/data-sources/:id`            | Update data source       | Bearer token |
| DELETE   | `/data-sources/:id`            | Delete data source       | Bearer token |
| POST     | `/data-sources/generate-title` | Generate AI title        | Bearer token |

### Composite Feeds

| Method   | Path                          | Description                     | Auth         |
| --------  | -----------------------------  | -------------------------------  | ------------  |
| POST     | `/composite-feeds`            | Create composite feed           | Bearer token |
| GET      | `/composite-feeds`            | List composite feeds            | Bearer token |
| GET      | `/composite-feeds/:id`        | Get composite feed              | Bearer token |
| PUT      | `/composite-feeds/:id`        | Update composite feed           | Bearer token |
| DELETE   | `/composite-feeds/:id`        | Delete feed                     | Bearer token |
| GET      | `/composite-feeds/:id/schema` | Get JSON Schema for feed data   | Bearer token |
| GET      | `/composite-feeds/:id/data`   | Get feed data                   | Bearer token |
| GET      | `/composite-feeds/:id/snapshot` | Get pre-computed snapshot data | Bearer token |

### Data Insights

| Method   | Path                               | Description          | Auth         |
| --------  | ----------------------------------  | --------------------  | ------------  |
| POST     | `/data-insights/analyze`           | Analyze data with AI | Bearer token |
| POST     | `/data-insights/chart-definition`  | Generate chart       | Bearer token |
| POST     | `/data-insights/transform-preview` | Transform data       | Bearer token |

### Snapshots

| Method   | Path                              | Description           | Auth           |
| --------  | ---------------------------------  | ---------------------  | --------------  |
| GET      | `/snapshots/:id`                  | Get cached snapshot   | Bearer token   |
| POST     | `/internal/snapshots/refresh-all` | Refresh all snapshots | Internal token |

## Domain Models

### DataSource

| Field       | Type   | Description                    |
| -----------  | ------  | ------------------------------  |
| `id`        | string | Unique identifier              |
| `userId`    | string | Owner user ID                  |
| `title`     | string | Data source title              |
| `content`   | string | Data content (CSV, JSON, etc.) |
| `createdAt` | Date   | Creation timestamp             |
| `updatedAt` | Date   | Last update timestamp          |

### CompositeFeed

| Field                | Type                            | Description                        |
| -------------------  | -------------------------------  | ----------------------------------  |
| `id`                 | string                          | Unique identifier                  |
| `userId`             | string                          | Owner user ID                      |
| `name`               | string                          | AI-generated feed name             |
| `purpose`            | string                          | User-provided feed purpose         |
| `staticSourceIds`    | string[]                        | Data source IDs                    |
| `notificationFilters` | NotificationFilterConfig[]     | Notification filter configs        |
| `dataInsights`       | DataInsight[] | null          | AI analysis results                |
| `createdAt`          | Date                            | Creation timestamp                 |
| `updatedAt`          | Date                            | Last update timestamp              |

### NotificationFilterConfig

| Field      | Type     | Description                        |
| ---------- | --------  | ----------------------------------  |
| `id`       | string   | Filter identifier                  |
| `name`     | string   | Filter name                        |
| `app`      | string[] | Multi-select app filter            |
| `source`   | string   | Single-select source filter        |
| `title`    | string   | Title filter substring match       |

### Snapshot

| Field          | Type   | Description        |
| --------------  | ------  | ------------------  |
| `id`           | string | Unique identifier  |
| `userId`       | string | Owner user ID      |
| `dataSourceId` | string | Source data ID     |
| `query`        | string | Analysis query     |
| `result`       | object | Analysis result    |
| `createdAt`    | Date   | Creation timestamp |

## Services

| Service                     | Purpose                            |
| ---------------------------  | ----------------------------------  |
| `dataSourceRepository`      | Firestore CRUD for data sources    |
| `titleGenerationService`    | Gemini AI title generation         |
| `compositeFeedRepository`   | Firestore CRUD for composite feeds |
| `feedNameGenerationService` | AI feed name generation            |
| `snapshotRepository`        | Cached analysis results            |
| `dataAnalysisService`       | Gemini data analysis               |
| `chartDefinitionService`    | Chart config generation            |
| `dataTransformService`      | Data transformation                |
| `mobileNotificationsClient` | Push notifications                 |
| `userServiceClient`         | Fetch API keys                     |

## Configuration

| Environment Variable                          | Required   | Description                     |
| ---------------------------------------------  | ----------  | -------------------------------  |
| `INTEXURAOS_USER_SERVICE_URL`                 | Yes        | user-service base URL           |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`              | Yes        | Shared secret for internal auth |
| `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL` | Yes        | Mobile notifications URL        |

## Gotchas

**Delete protection** - Data sources used by composite feeds return 409 Conflict.

**Title generation** - Returns MISCONFIGURED if no Google API key configured.

**Snapshot caching** - Analysis results cached to avoid re-computation.

**AI dependency** - Most features require Gemini API key configured in user-service.

## File Structure

```
apps/data-insights-agent/src/
  domain/
    dataSource/          # Data source models and ports
    compositeFeed/        # Composite feed models and ports
    snapshot/             # Cached analysis results
    dataInsights/         # Analysis use cases
  infra/
    firestore/            # Repository implementations
    gemini/               # AI services
    http/                 # External clients
    user/                 # user-service client
  routes/
    dataSourceRoutes.ts   # Data source endpoints
    compositeFeedRoutes.ts
    dataInsightsRoutes.ts
    internalRoutes.ts
  services.ts
```
