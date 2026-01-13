# Todos Agent - Technical Reference

## Overview

Todos-agent manages tasks with support for todo items, priorities, due dates, and AI-powered item extraction using Gemini.

## API Endpoints

### Public Endpoints

| Method | Path                   | Description             | Auth         |
| ------ | ---------------------- | ----------------------- | ------------ |
| GET    | `/todos`               | List todos (filterable) | Bearer token |
| POST   | `/todos`               | Create todo             | Bearer token |
| GET    | `/todos/:id`           | Get specific todo       | Bearer token |
| PATCH  | `/todos/:id`           | Update todo             | Bearer token |
| DELETE | `/todos/:id`           | Delete todo             | Bearer token |
| POST   | `/todos/:id/archive`   | Archive todo            | Bearer token |
| POST   | `/todos/:id/unarchive` | Unarchive todo          | Bearer token |
| POST   | `/todos/:id/cancel`    | Cancel todo             | Bearer token |

### Internal Endpoints

| Method | Path                          | Description            | Auth         |
| ------ | ----------------------------- | ---------------------- | ------------ |
| POST   | `/internal/todos`             | Create todo (internal) | Pub/Sub OIDC |
| POST   | `/internal/todos/:id/process` | Process Pub/Sub event  | Pub/Sub OIDC |

## Domain Models

### Todo

| Field         | Type         | Description            |
| ------------- | ------------ | ---------------------- | --------------------- | ---------- | -------------- | ------------ | --------- |
| `id`          | string       | Unique todo identifier |
| `userId`      | string       | Owner user ID          |
| `title`       | string       | Todo title             |
| `description` | string \     | null                   | Optional description  |
| `tags`        | string[]     | User-defined tags      |
| `priority`    | TodoPriority | low \                  | medium \              | high \     | urgent         |
| `dueDate`     | Date \       | null                   | Deadline              |
| `status`      | TodoStatus   | draft \                | processing \          | pending \  | in_progress \  | completed \  | cancelled |
| `archived`    | boolean      | Soft delete flag       |
| `items`       | TodoItem[]   | Sub-items              |
| `completedAt` | Date \       | null                   | When marked completed |
| `createdAt`   | Date         | Creation timestamp     |
| `updatedAt`   | Date         | Last update timestamp  |
| `source`      | string       | Source system          |
| `sourceId`    | string       | ID in source system    |

### TodoItem

| Field         | Type            | Description            |
| ------------- | --------------- | ---------------------- | --------------- |
| `id`          | string          | Unique item identifier |
| `title`       | string          | Item title             |
| `status`      | TodoItemStatus  | pending \              | completed       |
| `priority`    | TodoPriority \  | null                   | Item priority   |
| `dueDate`     | Date \          | null                   | Item deadline   |
| `position`    | number          | Display order          |
| `completedAt` | Date \          | null                   | Completion time |
| `createdAt`   | Date            | Creation timestamp     |
| `updatedAt`   | Date            | Last update timestamp  |

## Pub/Sub Events

### Subscribed

| Event Type       | Topic           | Handler                       |
| ---------------- | --------------- | ----------------------------- |
| `action.created` | `actions` queue | `/internal/todos/:id/process` |

### Published

None

## Dependencies

### Internal Services

| Service        | Purpose                         |
| -------------- | ------------------------------- |
| `user-service` | Fetch Google API key for Gemini |

### Infrastructure

| Component                      | Purpose          |
| ------------------------------ | ---------------- |
| Firestore (`todos` collection) | Todo persistence |
| Pub/Sub (`actions` queue)      | Action events    |

## Configuration

| Environment Variable              | Required | Description                     |
| --------------------------------- | -------- | ------------------------------- |
| `INTEXURAOS_USER_SERVICE_URL`     | Yes      | User-service base URL           |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE` | Yes      | Actions queue topic             |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`  | Yes      | Shared secret for internal auth |

## File Structure

```
apps/todos-agent/src/
  domain/
    models/
      todo.ts                  # Todo and TodoItem entities
    ports/
      todoRepository.ts
    usecases/
      createTodo.ts
      getTodo.ts
      listTodos.ts
      updateTodo.ts
      deleteTodo.ts
      archiveTodo.ts
      unarchiveTodo.ts
      cancelTodo.ts
      processTodoCreated.ts
      addTodoItem.ts
      updateTodoItem.ts
      deleteTodoItem.ts
      reorderTodoItems.ts
  infra/
    firestore/
      firestoreTodoRepository.ts
    gemini/
      todoItemExtractionService.ts
    user/
      userServiceClient.ts
  routes/
    todoRoutes.ts
    internalRoutes.ts
    pubsubRoutes.ts
```
