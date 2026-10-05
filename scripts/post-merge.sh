#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile
# Dependency setup only. Agent Smith owns its existing PostgreSQL tables via
# explicit SQL migrations; the empty template Drizzle schema must not push
# changes to this database. Never migrate, bootstrap Discord, or reset records
# automatically during a task merge.
