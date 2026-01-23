# linear-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with linear-agent.

---

## Identity

| Field    | Value                                                       |
| --------  | -----------------------------------------------------------  |
| **Name** | linear-agent                                                |
| **Role** | Linear Issue Management Service                             |
| **Goal** | Create and manage Linear issues from natural language input |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface LinearAgentTools {
  // List issues with filters
  listIssues(params?: {
    projectId?: string;
    stateId?: string;
    assigneeId?: string;
  }): Promise<LinearIssue[]>;

  // Create new issue
  createIssue(params: {
    title: string;
    description?: string;
    projectId?: string;
    priority?: number;
    estimate?: number;
    labelIds?: string[];
  }): Promise<LinearIssue>;

  // Get single issue
  getIssue(issueId: string): Promise<LinearIssue>;

  // Update issue
  updateIssue(
    issueId: string,
    params: {
      title?: string;
      description?: string;
      stateId?: string;
      priority?: number;
      estimate?: number;
      labelIds?: string[];
    }
  ): Promise<LinearIssue>;

  // Delete issue
  deleteIssue(issueId: string): Promise<void>;
}
```

### Types

```typescript
interface LinearIssue {
  id: string;
  identifier: string; // e.g., "INT-123"
  title: string;
  description?: string;
  priority: number;
  estimate?: number;
  state: {
    id: string;
    name: string;
  };
  project?: {
    id: string;
    name: string;
  };
  labels: { id: string; name: string }[];
  url: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## Constraints

| Rule                        | Description                                                |
| ---------------------------  | ----------------------------------------------------------  |
| **Linear API Key Required** | User must have Linear API key configured                   |
| **Team Scope**              | Issues created in user's default team                      |
| **Priority Scale**          | 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low |

---

## Usage Patterns

### Create Issue from Action

```typescript
const issue = await createIssue({
  title: 'Fix login redirect bug',
  description: 'Users are redirected to wrong page after login',
  priority: 2, // High
  labelIds: ['bug'],
});
```

### Update Issue State

```typescript
await updateIssue(issueId, {
  stateId: 'in_progress_state_id',
});
```

---

## Internal Endpoints

| Method | Path                   | Purpose                         |
| ------  | ----------------------  | -------------------------------  |
| POST   | `/internal/issues`     | Create issue from actions-agent |
| GET    | `/internal/issues/:id` | Get issue for internal services |

---

**Last updated:** 2026-01-19
