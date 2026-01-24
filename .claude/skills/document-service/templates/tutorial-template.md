# Tutorial Template

Template for `docs/services/<service-name>/tutorial.md`.

## Purpose

Getting-started guide that enables new developers to integrate with the service through progressive examples.

---

## Template

```markdown
# <Service Name> — Tutorial

> **Time:** 15-30 minutes
> **Prerequisites:** Node.js 20+, GCP project access
> **You'll learn:** How to integrate with <service-name> and handle common scenarios

---

## What You'll Build

A working integration that:
- <Outcome 1>
- <Outcome 2>
- <Outcome 3>

---

## Prerequisites

Before starting, ensure you have:
- [ ] Access to the IntexuraOS project
- [ ] Service account with appropriate permissions
- [ ] Basic understanding of TypeScript/Node.js

---

## Part 1: Hello World (5 minutes)

Let's start with the simplest possible interaction.

### Step 1.1: Make Your First Request

```bash
curl -X GET https://api.intexuraos.com/<endpoint> \
  -H "Authorization: Bearer $TOKEN"
```

**Expected response:**
```json
{
  "status": "healthy",
  "version": "1.0.0"
}
```

### What Just Happened?

<Explain the response and what the service did>

---

## Part 2: Create Your First Resource (10 minutes)

Now let's create something meaningful.

### Step 2.1: Prepare Your Data

```typescript
const resource = {
  name: "My First Item",
  // ... fields
};
```

### Step 2.2: Send the Request

```bash
curl -X POST https://api.intexuraos.com/<endpoint> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Item"
  }'
```

### Step 2.3: Verify Creation

```bash
curl https://api.intexuraos.com/<endpoint>/$ID \
  -H "Authorization: Bearer $TOKEN"
```

**Checkpoint:** You should see your created resource with all fields populated.

---

## Part 3: Handle Errors (5 minutes)

### Common Error: Validation Failed

**Error message:**
```json
{
  "code": "VALIDATION_ERROR",
  "message": "Field 'name' is required"
}
```

**Solution:** Ensure all required fields are included in your request.

### Common Error: Unauthorized

**Error message:**
```json
{
  "code": "UNAUTHORIZED",
  "message": "Invalid or expired token"
}
```

**Solution:** Refresh your access token and retry.

---

## Part 4: Real-World Scenario (10 minutes)

Let's put it all together in a practical workflow.

### Scenario: <Use case from features.md>

<Step-by-step walkthrough with actual code>

### Step 4.1: <First Step>

```typescript
// Code example
```

### Step 4.2: <Second Step>

```typescript
// Code example
```

### Step 4.3: <Final Step>

```typescript
// Code example
```

**Result:** <What the user should see>

---

## Troubleshooting

| Problem               | Solution                                    |
| --------------------- | ------------------------------------------- |
| "401 Unauthorized"    | Check your token is valid and not expired   |
| "404 Not Found"       | Verify the endpoint path is correct         |
| "429 Rate Limited"    | Wait a few seconds and retry                |
| "500 Server Error"    | Check service status, retry with backoff    |

---

## Next Steps

Now that you understand the basics:
1. Explore <advanced feature>
2. Read the [Technical Reference](technical.md) for full API details
3. Check out <related service> for more capabilities

---

## Exercises

Test your understanding:

1. **Easy:** Create a resource with custom metadata
2. **Medium:** Update a resource and handle conflicts
3. **Hard:** <More complex scenario involving multiple steps>

<details>
<summary>Solutions</summary>

### Exercise 1: Custom Metadata

```typescript
// Solution code
```

### Exercise 2: Update with Conflicts

```typescript
// Solution code
```

### Exercise 3: Complex Scenario

```typescript
// Solution code
```

</details>
```

---

## Writing Guidelines

### Progressive Complexity

1. **Part 1**: Simplest possible interaction (health check, list)
2. **Part 2**: Create something (POST request)
3. **Part 3**: Handle common errors
4. **Part 4**: Real-world scenario combining concepts

### Working Examples

- Every code block should be runnable
- Include expected output for each request
- Use realistic but simple data

### Error Anticipation

- Address common mistakes before they happen
- Include troubleshooting table
- Explain WHY errors occur, not just how to fix

### Checkpoints

- Clear validation points after each section
- "You should see..." statements
- Confirm understanding before progressing

### Exercises

- Three difficulty levels: Easy, Medium, Hard
- Include solutions in collapsible sections
- Build on tutorial concepts
