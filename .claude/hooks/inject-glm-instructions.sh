#!/bin/bash
# Inject GLM-coder usage instructions when running on Opus (not Z.ai)
#
# When ANTHROPIC_BASE_URL points to Z.ai, Claude IS GLM - no need for MCP tools.
# When running on standard Anthropic (Opus), GLM MCP tools provide code generation.

# Check if we're running through Z.ai (GLM orchestration)
if [[ "${ANTHROPIC_BASE_URL:-}" == *"z.ai"* ]]; then
  # Running on GLM/Z.ai - no need for GLM MCP tools
  echo "CONTINUE"
  exit 0
fi

# Running on Opus - inject GLM tool instructions
cat << 'EOF'
CONTINUE
---
## GLM-Coder Available (Opus Mode)

You have access to GLM-4.7 code generation via MCP tools. **Prefer these for code generation tasks:**

| Tool            | Use For                                    |
| --------------- | ------------------------------------------ |
| `generate_code` | New functions, use cases, utilities        |
| `generate_tests`| Vitest tests for existing code             |
| `glm_stats`     | View usage metrics                         |

**Load tools first:** `ToolSearch: "select:mcp__glm-coder__generate_code"`

**Provide context:**
- `contextFiles`: Related source files for patterns/types
- `targetFile`: Where code will live (enables validation)
- `style`: "minimal" | "documented" | "defensive"

**Don't use GLM for:** debugging, small edits (<10 lines), multi-file refactoring, or tasks requiring deep project knowledge.

Full reference: `.claude/reference/glm-coder.md`
EOF
