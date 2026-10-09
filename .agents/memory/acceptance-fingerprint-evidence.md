---
name: Acceptance fingerprint evidence
description: Preserve full-hash acceptance criteria; missing historical semantic baselines cannot be repaired by later normalization.
---

Do not dismiss a failed supplied full-row fingerprint as harmless or claim
logical equivalence by stripping changing fields after the release.

**Why:** During LMOC post-release verification, Hallowed Core's full member hash
changed while its existing maintenance reconciliation updated timestamps.
The earlier checkpoint captured only full hashes, not a comparable historical
semantic hash, so unchanged logical content could not be proven retrospectively.

**How to apply:** Keep the user's exact full-hash result visible. For future
approved comparisons, capture both full and explicitly reviewed semantic
fingerprints before changes, without storing member rows/PII in memory.
Normal background writes may explain a mismatch mechanism, but do not prove
they are the only differences.
