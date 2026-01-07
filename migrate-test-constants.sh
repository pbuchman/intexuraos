#!/bin/bash
# Script to migrate hardcoded LLM model and provider strings to constants in test files

# Find all test files (excluding already migrated ones)
find apps packages -name "*.test.ts" -type f | while read -r file; do
  # Skip if file doesn't exist or is empty
  [ ! -s "$file" ] && continue

  # Check if file contains hardcoded model strings
  if grep -q "'gemini-\|'claude-\|'o4-\|'gpt-\|'sonar-\|'google'\|'anthropic'\|'openai'\|'perplexity'" "$file" 2>/dev/null; then
    echo "Processing: $file"

    # Add import if not already present
    if ! grep -q "import.*LlmModels.*from '@intexuraos/llm-contract'" "$file"; then
      # Find the first import line and add after it
      sed -i "1a import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';" "$file"
    fi

    # Replace model strings
    sed -i "s/'gemini-2\.5-pro'/LlmModels.Gemini25Pro/g" "$file"
    sed -i "s/'gemini-2\.5-flash'/LlmModels.Gemini25Flash/g" "$file"
    sed -i "s/'gemini-2\.0-flash'/LlmModels.Gemini20Flash/g" "$file"
    sed -i "s/'o4-mini-deep-research'/LlmModels.O4MiniDeepResearch/g" "$file"
    sed -i "s/'o4-mini'/LlmModels.O4Mini/g" "$file"
    sed -i "s/'gpt-4o'/LlmModels.Gpt4o/g" "$file"
    sed -i "s/'gpt-4o-mini'/LlmModels.Gpt4oMini/g" "$file"
    sed -i "s/'claude-sonnet-4-5-20250929'/LlmModels.ClaudeSonnet4520250929/g" "$file"
    sed -i "s/'claude-sonnet-4-20250514'/LlmModels.ClaudeSonnet420250514/g" "$file"
    sed -i "s/'claude-opus-4-5-20251101'/LlmModels.ClaudeOpus4520251101/g" "$file"
    sed -i "s/'sonar-pro'/LlmModels.SonarPro/g" "$file"

    # Replace provider strings
    sed -i "s/'google'/LlmProviders.Google/g" "$file"
    sed -i "s/'anthropic'/LlmProviders.Anthropic/g" "$file"
    sed -i "s/'openai'/LlmProviders.OpenAI/g" "$file"
    sed -i "s/'perplexity'/LlmProviders.Perplexity/g" "$file"
  fi
done

echo "Migration complete!"
