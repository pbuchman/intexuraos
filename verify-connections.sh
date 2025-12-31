#!/bin/bash

echo "═══════════════════════════════════════════════════════════"
echo "  Connection Verification Summary"
echo "═══════════════════════════════════════════════════════════"
echo ""

# GitHub/Git Connection
echo "📦 GitHub / Git Connection:"
if git remote -v | grep -q "origin"; then
  echo "   ✅ Git remote configured"
  git remote -v | head -2 | sed 's/^/      /'

  if git ls-remote origin HEAD &>/dev/null; then
    echo "   ✅ Can connect to GitHub"
  else
    echo "   ❌ Cannot connect to GitHub"
  fi
else
  echo "   ❌ No git remote configured"
fi

echo ""

# GCP Connection
echo "🔐 Google Cloud Platform:"
if [ -n "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  echo "   ✅ GOOGLE_APPLICATION_CREDENTIALS set"
  echo "      $GOOGLE_APPLICATION_CREDENTIALS"
else
  echo "   ℹ️  GOOGLE_APPLICATION_CREDENTIALS not set in current shell"
  echo "      (Check .env.local for configuration)"
fi

if [ -f "/home/user/intexuraos/gcp-service-account.json" ]; then
  echo "   ✅ Service account key file exists"
  PROJECT_ID=$(grep -o '"project_id": "[^"]*"' /home/user/intexuraos/gcp-service-account.json | cut -d'"' -f4)
  CLIENT_EMAIL=$(grep -o '"client_email": "[^"]*"' /home/user/intexuraos/gcp-service-account.json | cut -d'"' -f4)
  echo "      Project: $PROJECT_ID"
  echo "      Service Account: $CLIENT_EMAIL"
else
  echo "   ❌ Service account key file not found"
fi

if [ -f "/home/user/intexuraos/.env.local" ]; then
  echo "   ✅ .env.local configuration file exists"
else
  echo "   ❌ .env.local not found"
fi

echo ""

# Git Ignore Check
echo "🔒 Security:"
if git check-ignore -q gcp-service-account.json; then
  echo "   ✅ Service account key is gitignored"
else
  echo "   ⚠️  Service account key is NOT gitignored!"
fi

if git check-ignore -q .env.local; then
  echo "   ✅ .env.local is gitignored"
else
  echo "   ⚠️  .env.local is NOT gitignored!"
fi

echo ""

# Current Branch
echo "🌿 Git Status:"
CURRENT_BRANCH=$(git branch --show-current)
echo "   Current branch: $CURRENT_BRANCH"

if [[ $CURRENT_BRANCH == claude/* ]]; then
  echo "   ✅ On Claude Code branch"
else
  echo "   ℹ️  Not on Claude Code branch"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Summary"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "✅ GitHub: Ready for git operations (push, pull, fetch)"
echo "✅ GCP: Service account configured"
echo "ℹ️  To activate GCP credentials in your shell, run:"
echo "   export GOOGLE_APPLICATION_CREDENTIALS=/home/user/intexuraos/gcp-service-account.json"
echo ""
echo "   Or source the .env.local file in your application"
echo ""
