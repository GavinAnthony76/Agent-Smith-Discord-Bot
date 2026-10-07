---
name: Generated soundtrack duration
description: Generated music duration and browser audio-startup timing can differ from their requested or reported values.
---

Music generation's requested duration is not an exact file-length guarantee. Measure the returned audio before fixing or verifying the visual runtime.

**Why:** A requested 55-second instrumental returned roughly 64 seconds. The approved film range was 45–60 seconds, so accepting the file length silently would have exceeded the brief.

**How to apply:** Use ffprobe on generated audio. Keep the approved visual duration when appropriate, trim the single score with a smooth ending fade, and verify canonical scene offsets and actual playback rather than relying on the generation request.

## Browser startup alignment

A successful audio play promise or `playing` event does not prove the media clock is aligned with the film clock.

**Why:** The headless Chromium audio sink initially lagged the visual clock by roughly two seconds even after reporting playback. Seeking only after metadata or the play promise did not remove it; bounded correction using native media time updates did.

**How to apply:** Compare actual audio currentTime against elapsed scene time in a real browser. Allow a short, bounded startup catch-up using canonical offsets and elapsed scene time, then stop corrections. Preserve accumulated elapsed time across pause/resume; never reset resumed audio to the scene's start.
