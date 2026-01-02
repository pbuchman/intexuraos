# Action Configuration DSL Reference

**Version:** 1.0
**File:** `apps/web/public/action-config.yaml`

## Overview

The action configuration system provides a declarative way to define action buttons for the IntexuraOS frontend. Actions are triggered on user interaction and execute API calls to backend services.

**Key Features:**

- Tree-based logical conditions (AND/OR/NOT)
- Variable interpolation from action data
- Type-safe predicate evaluation (no eval())
- Dynamic button rendering based on action state

## File Structure

```yaml
# Global action definitions
actions:
  action-id:
    endpoint: { ... }
    ui: { ... }

# Type-specific action mappings
types:
  action-type:
    actions:
      - action: action-id
        when: { ... }
```

### Top-Level Keys

| Key       | Type   | Required | Description                                     |
| --------- | ------ | -------- | ----------------------------------------------- |
| `actions` | Object | Yes      | Global action definitions (button behavior)     |
| `types`   | Object | Yes      | Mappings from action types to available actions |

---

## Action Definitions

Actions define **what happens** when a button is clicked.

### Syntax

```yaml
actions:
  action-id:
    endpoint:
      path: /api/endpoint
      method: GET|POST|PATCH|DELETE
      body: # Optional
        key: value
    ui:
      label: Button Text
      variant: primary|secondary|danger
      icon: IconName
```

### Fields

#### `endpoint` (required)

Defines the HTTP request to execute.

| Field    | Type   | Required | Description                                           |
| -------- | ------ | -------- | ----------------------------------------------------- |
| `path`   | String | Yes      | API endpoint path (supports `{actionId}` placeholder) |
| `method` | String | Yes      | HTTP method (`GET`, `POST`, `PATCH`, `DELETE`)        |
| `body`   | Object | No       | Request body (supports variable interpolation)        |

**Path Placeholders:**

- `{actionId}` - Replaced with actual action ID at runtime

**Example:**

```yaml
endpoint:
  path: /router/actions/{actionId}
  method: PATCH
  body:
    status: processing
```

#### `ui` (required)

Defines the button appearance.

| Field     | Type   | Required | Description                                          |
| --------- | ------ | -------- | ---------------------------------------------------- |
| `label`   | String | Yes      | Button text displayed to user                        |
| `variant` | String | Yes      | Button styling (`primary`, `secondary`, `danger`)    |
| `icon`    | String | Yes      | Lucide icon name (e.g., `Play`, `Trash2`, `XCircle`) |

**Variants:**

- `primary` - Blue background, white text (CTA)
- `secondary` - Gray text, hover background (neutral)
- `danger` - Red text on hover (destructive)

**Example:**

```yaml
ui:
  label: Approve & Start
  variant: primary
  icon: Play
```

---

## Variable Interpolation

Request bodies support variable interpolation using `{{variable}}` syntax.

### Syntax

```yaml
body:
  field: '{{action.fieldName}}'
  nested: '{{action.payload.nestedField}}'
```

### Available Variables

| Variable                | Type   | Description                                   |
| ----------------------- | ------ | --------------------------------------------- |
| `{{action.id}}`         | String | Action ID                                     |
| `{{action.userId}}`     | String | User ID                                       |
| `{{action.commandId}}`  | String | Command ID                                    |
| `{{action.type}}`       | String | Action type (e.g., `research`, `todo`)        |
| `{{action.confidence}}` | Number | Classification confidence (0-1)               |
| `{{action.title}}`      | String | Action title                                  |
| `{{action.status}}`     | String | Action status (`pending`, `processing`, etc.) |
| `{{action.payload.*}}`  | Any    | Payload field (dot-notation supported)        |
| `{{action.createdAt}}`  | String | ISO timestamp                                 |
| `{{action.updatedAt}}`  | String | ISO timestamp                                 |

### Dot-Notation

Access nested fields using dot notation:

```yaml
body:
  prompt: '{{action.payload.prompt}}'
  name: '{{action.payload.metadata.name}}'
```

### String Interpolation

Variables can be embedded in strings:

```yaml
body:
  message: 'Processing action {{action.id}} with confidence {{action.confidence}}'
```

### Type Conversion

- Numbers are converted to strings when interpolated in string context
- `null` and `undefined` values become empty strings (`""`)

### Example

```yaml
endpoint:
  path: /llm/research/draft
  method: POST
  body:
    prompt: '{{action.payload.prompt}}'
    metadata:
      actionId: '{{action.id}}'
      confidence: '{{action.confidence}}'
```

---

## Type Mappings

Type mappings define **which actions** are available for each action type.

### Syntax

```yaml
types:
  action-type:
    actions:
      - action: action-id
        when: { ... } # Optional condition
```

### Fields

| Field    | Type          | Required | Description                                   |
| -------- | ------------- | -------- | --------------------------------------------- |
| `action` | String        | Yes      | Reference to action ID from `actions` section |
| `when`   | ConditionTree | No       | Logical condition (if omitted, always true)   |

### Example

```yaml
types:
  research:
    actions:
      - action: approve-research
        when:
          field: status
          op: eq
          value: pending

      - action: delete
        when:
          field: status
          op: eq
          value: failed
```

---

## Condition Tree DSL

Conditions control **when** an action button is visible.

### Overview

Conditions are evaluated as logical trees supporting:

- **Predicates** - Compare action fields to values
- **AND logic** - All conditions must be true (`all`)
- **OR logic** - At least one condition must be true (`any`)
- **NOT logic** - Negate a condition (`not`)

### Predicate Syntax

```yaml
when:
  field: fieldName
  op: operator
  value: expectedValue
```

#### Fields

| Field   | Type   | Required | Description                                               |
| ------- | ------ | -------- | --------------------------------------------------------- |
| `field` | String | Yes      | Dot-notation path to action field                         |
| `op`    | String | Yes      | Comparison operator (see below)                           |
| `value` | Any    | No\*     | Value to compare against (\*required except for `exists`) |

#### Operators

| Operator | Description                       | Example                                | Value Type         |
| -------- | --------------------------------- | -------------------------------------- | ------------------ |
| `eq`     | Equality (`===`)                  | `status == 'pending'`                  | Any                |
| `neq`    | Not equal (`!==`)                 | `status != 'completed'`                | Any                |
| `gt`     | Greater than                      | `confidence > 0.8`                     | Number             |
| `gte`    | Greater than or equal             | `confidence >= 0.8`                    | Number             |
| `lt`     | Less than                         | `confidence < 0.5`                     | Number             |
| `lte`    | Less than or equal                | `confidence <= 0.5`                    | Number             |
| `in`     | Value in array                    | `status in ['pending', 'processing']`  | Array              |
| `nin`    | Value not in array                | `status not in ['failed', 'rejected']` | Array              |
| `exists` | Field exists (not null/undefined) | `payload.prompt exists`                | Boolean (optional) |

#### Examples

**Equality:**

```yaml
when:
  field: status
  op: eq
  value: pending
```

**Comparison:**

```yaml
when:
  field: confidence
  op: gt
  value: 0.8
```

**Membership:**

```yaml
when:
  field: status
  op: in
  value: [pending, processing]
```

**Existence:**

```yaml
# Check field exists
when:
  field: payload.prompt
  op: exists

# Check field exists and is true
when:
  field: payload.prompt
  op: exists
  value: true

# Check field does NOT exist
when:
  field: payload.optional
  op: exists
  value: false
```

### AND Logic (`all`)

All conditions must be true.

```yaml
when:
  all:
    - { field: status, op: eq, value: pending }
    - { field: confidence, op: gt, value: 0.8 }
```

**Evaluation:** Short-circuits on first `false` (performance optimization).

### OR Logic (`any`)

At least one condition must be true.

```yaml
when:
  any:
    - { field: status, op: eq, value: pending }
    - { field: status, op: eq, value: processing }
```

**Evaluation:** Short-circuits on first `true` (performance optimization).

### NOT Logic (`not`)

Negates a condition.

```yaml
when:
  not:
    field: status
    op: eq
    value: rejected
```

### Nested Conditions

Conditions can be nested to arbitrary depth.

**Complex Example:**

```yaml
when:
  all:
    - field: type
      op: eq
      value: research
    - any:
        - field: status
          op: eq
          value: pending
        - all:
            - field: status
              op: eq
              value: processing
            - field: confidence
              op: gt
              value: 0.9
```

**Logical interpretation:**

```
type == 'research' AND (
  status == 'pending' OR (
    status == 'processing' AND confidence > 0.9
  )
)
```

---

## Complete Examples

### Example 1: Simple Status-Based Action

```yaml
actions:
  approve:
    endpoint:
      path: /router/actions/{actionId}
      method: PATCH
      body:
        status: processing
    ui:
      label: Approve
      variant: primary
      icon: Check

types:
  research:
    actions:
      - action: approve
        when:
          field: status
          op: eq
          value: pending
```

### Example 2: Multiple Actions with Complex Conditions

```yaml
actions:
  approve-high-confidence:
    endpoint:
      path: /router/actions/{actionId}
      method: PATCH
      body:
        status: processing
    ui:
      label: Auto-Approve
      variant: primary
      icon: Zap

  review-manual:
    endpoint:
      path: /router/actions/{actionId}
      method: PATCH
      body:
        status: pending_review
    ui:
      label: Review Manually
      variant: secondary
      icon: Eye

  reject:
    endpoint:
      path: /router/actions/{actionId}
      method: PATCH
      body:
        status: rejected
    ui:
      label: Reject
      variant: danger
      icon: XCircle

types:
  research:
    actions:
      # Auto-approve if confidence > 0.9 and status is pending
      - action: approve-high-confidence
        when:
          all:
            - { field: status, op: eq, value: pending }
            - { field: confidence, op: gt, value: 0.9 }

      # Manual review if confidence between 0.5-0.9
      - action: review-manual
        when:
          all:
            - { field: status, op: eq, value: pending }
            - { field: confidence, op: gt, value: 0.5 }
            - { field: confidence, op: lte, value: 0.9 }

      # Reject if confidence < 0.5 OR status is failed
      - action: reject
        when:
          any:
            - all:
                - { field: status, op: eq, value: pending }
                - { field: confidence, op: lt, value: 0.5 }
            - { field: status, op: eq, value: failed }
```

### Example 3: Action with Variable Interpolation

```yaml
actions:
  create-draft:
    endpoint:
      path: /llm/research/draft
      method: POST
      body:
        prompt: '{{action.payload.prompt}}'
        metadata:
          source: action
          actionId: '{{action.id}}'
          confidence: '{{action.confidence}}'
    ui:
      label: Save as Draft
      variant: secondary
      icon: FileText

types:
  research:
    actions:
      - action: create-draft
        when:
          all:
            - { field: status, op: eq, value: pending }
            - { field: payload.prompt, op: exists }
```

---

## Best Practices

### 1. Action Naming

Use descriptive, action-oriented IDs:

- ✅ `approve-research`, `reject-proposal`, `create-draft`
- ❌ `button1`, `action-a`, `thing`

### 2. Condition Complexity

Keep conditions readable:

- ✅ Nest logically related conditions
- ✅ Use meaningful field names
- ❌ Don't nest more than 3 levels deep
- ❌ Don't create overly complex trees

### 3. Variable Interpolation

Validate required fields exist:

```yaml
# Good - checks field exists before using it
when:
  field: payload.prompt
  op: exists

# Then safely interpolate
body:
  prompt: '{{action.payload.prompt}}'
```

### 4. Type Safety

Use appropriate operators for data types:

- Strings: `eq`, `neq`, `in`, `nin`, `exists`
- Numbers: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
- Mixed: `exists`

### 5. Button Order

Actions are displayed in the order defined in `types.<type>.actions`:

```yaml
types:
  research:
    actions:
      - action: primary-action # Appears first (left)
      - action: secondary-action # Appears second
      - action: danger-action # Appears last (right)
```

### 6. Status Transitions

Document valid status transitions:

```yaml
# Valid transitions:
# pending -> processing (approve)
# pending -> rejected (reject)
# processing -> completed (success)
# processing -> failed (error)
```

### 7. Fallback Behavior

If no type mapping exists or no conditions match:

- Frontend shows default delete button (if configured in fallback)
- Or shows no action buttons

---

## Validation

The configuration loader validates:

1. ✅ YAML syntax is valid
2. ✅ `actions` and `types` sections exist
3. ✅ Each action has `endpoint` and `ui` sections
4. ✅ Action references in type mappings exist
5. ❌ **NOT validated:** Condition tree structure (runtime evaluation)
6. ❌ **NOT validated:** Variable interpolation (runtime check)

**Runtime Errors:**

- Invalid condition structure → condition evaluates to `false`
- Missing interpolated field → empty string (`""`)
- Undefined action reference → button not rendered (warning logged)

---

## Migration Guide

### From String Conditions (Old Format)

**Old:**

```yaml
types:
  research:
    actions:
      - action: approve
        conditions:
          - "status == 'pending'"
          - 'confidence > 0.8'
```

**New:**

```yaml
types:
  research:
    actions:
      - action: approve
        when:
          all:
            - { field: status, op: eq, value: pending }
            - { field: confidence, op: gt, value: 0.8 }
```

**Migration Steps:**

1. Replace `conditions` with `when`
2. Convert each string condition to a predicate
3. Wrap multiple conditions in `all` (implicit AND)
4. Remove quotes around field values

---

## Troubleshooting

### Button Not Showing

**Check:**

1. Action is defined in `actions` section
2. Type mapping exists for action type
3. Condition evaluates to `true` (check field values)
4. Referenced action ID matches exactly

### Variable Interpolation Failed

**Check:**

1. Field path is correct (use dot notation for nesting)
2. Field exists in action payload
3. Syntax is `{{action.field}}` (not `{action.field}`)

### Condition Never True

**Check:**

1. Operator is correct for data type (string vs number)
2. Value matches expected type (e.g., `0.8` not `"0.8"`)
3. Field path is correct
4. Logical operators are correct (`all` vs `any`)

---

## API Reference

### Action Object Structure

```typescript
interface Action {
  id: string;
  userId: string;
  commandId: string;
  type: CommandType; // 'research' | 'todo' | 'note' | 'link' | 'calendar' | 'reminder' | 'unclassified'
  confidence: number;
  title: string;
  status: ActionStatus; // 'pending' | 'processing' | 'completed' | 'failed' | 'rejected'
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

### Configuration Schema

```typescript
interface ActionConfig {
  actions: Record<string, ActionConfigAction>;
  types: Partial<Record<CommandType, ActionConfigType>>;
}

interface ActionConfigAction {
  endpoint: ActionConfigEndpoint;
  ui: ActionConfigUI;
}

interface ActionConfigEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
}

interface ActionConfigUI {
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  icon: string;
}

interface ActionConfigTypeMapping {
  action: string;
  when?: ConditionTree;
}

type ConditionTree = Predicate | AllCondition | AnyCondition | NotCondition;

interface Predicate {
  field: string;
  op: PredicateOperator;
  value?: unknown;
}

type PredicateOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'exists';

interface AllCondition {
  all: ConditionTree[];
}

interface AnyCondition {
  any: ConditionTree[];
}

interface NotCondition {
  not: ConditionTree;
}
```

---

## Related Documentation

- [Service-to-Service Communication](./service-to-service-communication.md)
- [Commands Router Architecture](../apps/commands-router/README.md)
- [Variable Interpolator Tests](../apps/web/src/services/__tests__/variableInterpolator.test.ts)
- [Condition Evaluator Tests](../apps/web/src/services/__tests__/conditionEvaluator.test.ts)
