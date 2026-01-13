# Bookmarks Agent - Technical Reference

## Overview

Bookmarks-agent provides CRUD operations for user bookmarks with automatic OpenGraph metadata fetching via web-agent. Supports tags, archiving, and AI summaries.

## API Endpoints

### Public Endpoints

| Method   | Path                       | Description                        | Auth         |
| --------  | --------------------------  | ----------------------------------  | ------------  |
| GET      | `/bookmarks`               | List user's bookmarks (filterable) | Bearer token |
| POST     | `/bookmarks`               | Create new bookmark                | Bearer token |
| GET      | `/bookmarks/:id`           | Get specific bookmark              | Bearer token |
| PATCH    | `/bookmarks/:id`           | Update bookmark                    | Bearer token |
| DELETE   | `/bookmarks/:id`           | Delete bookmark                    | Bearer token |
| POST     | `/bookmarks/:id/archive`   | Archive a bookmark                 | Bearer token |
| POST     | `/bookmarks/:id/unarchive` | Unarchive a bookmark               | Bearer token |
| GET      | `/images/proxy`            | Proxy external images (no auth)    | None         |

### Internal Endpoints

| Method   | Path                                    | Description                | Auth            |
| --------  | ---------------------------------------  | --------------------------  | ---------------  |
| POST     | `/internal/bookmarks/enrich`            | Trigger OpenGraph fetch    | Pub/Sub OIDC    |
| POST     | `/internal/bookmarks/:id/force-refresh` | Force refresh metadata     | Internal header |
| PATCH    | `/internal/bookmarks/:id`               | Update bookmark (internal) | Internal header |

## Domain Models

### Bookmark

| Field            | Type               | Description                      |
| ----------------  | ------------------  | --------------------------------  |
| `id`             | string             | Unique bookmark identifier       |
| `userId`         | string             | Owner user ID                    |
| `status`         | 'draft' \          | 'active'                         | Draft or active status |
| `url`            | string             | Bookmark URL                     |
| `title`          | string \           | null                             | Page title |
| `description`    | string \           | null                             | Page description |
| `tags`           | string[]           | User-defined tags                |
| `ogPreview`      | OpenGraphPreview \ | null                             | Fetched metadata |
| `ogFetchedAt`    | Date \             | null                             | When metadata was fetched |
| `ogFetchStatus`  | 'pending' \        | 'processed' \                    | 'failed' | Metadata fetch status |
| `aiSummary`      | string \           | null                             | AI-generated summary |
| `aiSummarizedAt` | Date \             | null                             | When summary was generated |
| `source`         | string             | Source system (e.g., 'whatsapp') |
| `sourceId`       | string             | ID in source system              |
| `archived`       | boolean            | Soft delete flag                 |
| `createdAt`      | Date               | Creation timestamp               |
| `updatedAt`      | Date               | Last update timestamp            |

### OpenGraphPreview

| Field         | Type     | Description   |
| -------------  | --------  | -------------  |
| `title`       | string \ | null          | OG title |
| `description` | string \ | null          | OG description |
| `image`       | string \ | null          | OG image URL |
| `siteName`    | string \ | null          | OG site name |
| `type`        | string \ | null          | OG type |
| `favicon`     | string \ | null          | Favicon URL |

## Pub/Sub Events

### Subscribed

| Event Type                     | Handler                      |
| ------------------------------  | ----------------------------  |
| `whatsapp.linkpreview.extract` | `/internal/bookmarks/enrich` |

### Published

None

## Dependencies

### Internal Services

| Service     | Purpose                     |
| -----------  | ---------------------------  |
| `web-agent` | OpenGraph metadata fetching |

### Infrastructure

| Component                          | Purpose              |
| ----------------------------------  | --------------------  |
| Firestore (`bookmarks` collection) | Bookmark persistence |

## Configuration

| Environment Variable                | Required   | Description        |
| -----------------------------------  | ----------  | ------------------  |
| `INTEXURAOS_WEB_AGENT_URL`          | Yes        | Web-agent base URL |
| `INTEXURAOS_PUBSUB_ENRICH_BOOKMARK` | Yes        | Enrichment topic   |

## File Structure

```
apps/bookmarks-agent/src/
  domain/
    models/
      bookmark.ts              # Bookmark entity
    ports/
      bookmarkRepository.ts
      linkPreviewFetcher.ts
    usecases/
      createBookmark.ts
      getBookmark.ts
      listBookmarks.ts
      updateBookmark.ts
      deleteBookmark.ts
      archiveBookmark.ts
      unarchiveBookmark.ts
      enrichBookmark.ts
      forceRefreshBookmark.ts
      updateBookmarkInternal.ts
  infra/
    firestore/
      firestoreBookmarkRepository.ts
    linkpreview/
      webAgentClient.ts
    pubsub/
      enrichPublisher.ts
  routes/
    bookmarkRoutes.ts
    internalRoutes.ts
    pubsubRoutes.ts
```
