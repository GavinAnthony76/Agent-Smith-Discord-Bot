#!/bin/bash
set -euo pipefail
# Development-only merge setup, never a publishing build/startup command.
# Owner-approved exception: apply ONLY Smith's existing additive feed migration
# so task-local schema is also present in main's development database.
# No template schema push, other migrations, Discord bootstrap, or record reset.
if [ "${NODE_ENV:-}" = "production" ]; then
  echo "Post-merge feed setup is development-only. Use Publishing for production schema." >&2
  exit 1
fi
pnpm install --frozen-lockfile
pnpm --filter @workspace/agent-smith run feeds:migrate
# Verify required runtime columns read-only; fail visibly on incomplete schema.
pnpm --filter @workspace/agent-smith run feeds:schema-check
