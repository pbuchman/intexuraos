# GLM-Coder MCP Reference

**MCP Tools:** `generate_code`, `generate_tests`, `glm_stats`

GLM-4.7 is a specialized code generation model available via MCP.

## When to Use GLM

| Scenario                              | Use GLM? | Why                                     |
| ------------------------------------- | -------- | --------------------------------------- |
| User says "use GLM" or "use glm"      | ✅ Yes   | Explicit request                        |
| Generating a new utility function     | ✅ Yes   | Isolated, well-scoped                   |
| Writing tests for existing code       | ✅ Yes   | `generate_tests` is purpose-built       |
| Complex refactoring across files      | ❌ No    | Needs broader context than GLM receives |
| Debugging/investigating issues        | ❌ No    | Requires reading code, not generating   |
| Small edits (< 10 lines)              | ❌ No    | Overhead not worth it                   |
| Code requiring deep project knowledge | ❌ No    | GLM lacks full codebase context         |

## How to Use Effectively

**1. Provide context files:**

```
contextFiles: ["src/domain/models/user.ts", "src/types.ts"]
```

**2. Specify target location:**

```
targetFile: "src/domain/usecases/createUser.ts"
```

**3. Be specific in the task:**

```
// ❌ Vague
task: "Create a user service"

// ✅ Specific
task: "Create a createUser use case that validates email uniqueness,
       hashes password with bcrypt, stores in UserRepository,
       returns Result<User, CreateUserError>"
```

**4. Request style when needed:**

```
style: "defensive"  // Adds null checks, error handling
style: "minimal"    // Just the logic, no extras
style: "documented" // Includes JSDoc comments
```

## Loading the Tools

GLM tools are deferred. Load before use:

```
ToolSearch: "select:mcp__glm-coder__generate_code"
```

## Development Mode

For hot-reload development of the MCP server itself:

```bash
# Terminal 1: Run dev server
cd tools/mcp-glm-coder && pnpm dev:server

# .mcp.json points to proxy (auto-reconnects on server restart)
```

If you see "GLM Dev Server Unavailable", the dev server needs to be started.
