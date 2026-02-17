#!/bin/bash
set -euo pipefail

# Production wrapper script for orchestrator worker
# This script will be enhanced in subsequent issues to handle:
# - Health checks
# - Graceful shutdown
# - Environment variable validation
# - Logging configuration

echo "Starting Orchestrator Worker..."
exec node dist/index.js
