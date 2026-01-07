#!/usr/bin/env python3
"""
Migrate hardcoded LLM model and provider strings to constants in test files.
"""

import re
from pathlib import Path
import sys

# Model mappings
MODEL_MAPPINGS = {
    "'gemini-2.5-pro'": "LlmModels.Gemini25Pro",
    "'gemini-2.5-flash'": "LlmModels.Gemini25Flash",
    "'gemini-2.0-flash'": "LlmModels.Gemini20Flash",
    "'o4-mini-deep-research'": "LlmModels.O4MiniDeepResearch",
    "'o4-mini'": "LlmModels.O4Mini",
    "'o1-deep-research'": "LlmModels.O1DeepResearch",
    "'gpt-4o'": "LlmModels.Gpt4o",
    "'gpt-4o-mini'": "LlmModels.Gpt4oMini",
    "'claude-sonnet-4-5-20250929'": "LlmModels.ClaudeSonnet4520250929",
    "'claude-sonnet-4-20250514'": "LlmModels.ClaudeSonnet420250514",
    "'claude-opus-4-5-20251101'": "LlmModels.ClaudeOpus4520251101",
    "'sonar-pro'": "LlmModels.SonarPro",
    "'imagen-3'": "LlmModels.Imagen3",
    "'dall-e-3'": "LlmModels.DallE3",
}

PROVIDER_MAPPINGS = {
    "'google'": "LlmProviders.Google",
    "'anthropic'": "LlmProviders.Anthropic",
    "'openai'": "LlmProviders.OpenAI",
    "'perplexity'": "LlmProviders.Perplexity",
}

def needs_migration(content):
    """Check if file needs migration."""
    for pattern in list(MODEL_MAPPINGS.keys()) + list(PROVIDER_MAPPINGS.keys()):
        if pattern in content:
            return True
    return False

def add_import_if_needed(content):
    """Add import statement if not present."""
    import_statement = "import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';"

    if "LlmModels" in content and "LlmProviders" in content:
        return content  # Already has both

    if "from '@intexuraos/llm-contract'" in content:
        # Already importing from llm-contract, update the import
        content = re.sub(
            r"import\s*{([^}]+)}\s*from\s*'@intexuraos/llm-contract';",
            lambda m: f"import {{ LlmModels, LlmProviders }} from '@intexuraos/llm-contract';",
            content
        )
        return content

    # Find first import line and add after it
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if line.startswith('import ') and 'from' in line:
            lines.insert(i + 1, import_statement)
            return '\n'.join(lines)

    return content

def migrate_file(file_path):
    """Migrate a single test file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        if not needs_migration(content):
            return False

        print(f"Migrating: {file_path}")

        # Add import
        content = add_import_if_needed(content)

        # Replace models
        for old, new in MODEL_MAPPINGS.items():
            content = content.replace(old, new)

        # Replace providers
        for old, new in PROVIDER_MAPPINGS.items():
            content = content.replace(old, new)

        # Write back
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)

        return True
    except Exception as e:
        print(f"Error migrating {file_path}: {e}", file=sys.stderr)
        return False

def main():
    """Main migration function."""
    base_paths = [
        Path("apps"),
        Path("packages"),
    ]

    migrated_count = 0
    for base_path in base_paths:
        if not base_path.exists():
            continue

        for test_file in base_path.rglob("*.test.ts"):
            if migrate_file(test_file):
                migrated_count += 1

    print(f"\nMigration complete! Migrated {migrated_count} files.")

if __name__ == "__main__":
    main()
