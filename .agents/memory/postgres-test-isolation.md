---
name: PostgreSQL test isolation
description: Why disposable schema tests must not fall back to the live public schema.
---

Disposable-schema tests must exclude the live public schema from their search
path when exercising missing-schema behavior or using unqualified table names.

**Why:** After development acquired the feed tables, an isolated missing-table
check unexpectedly passed because PostgreSQL resolved the absent test table in
public. The same fallback could direct test writes into live tables.

**How to apply:** Use only the disposable schema in the test connection's search
path; built-in PostgreSQL functions remain available through pg_catalog. Create
all required fixtures explicitly and never infer migration readiness from a
test that can resolve tables outside its isolation boundary.
