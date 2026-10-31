# G10 deterministic playback schedule — independently authored samples

Generate the fixture manifest with `node examples/g10-playback/create-authored.mjs`, then run:

```sh
node scripts/g10-playback.mjs dry-run examples/g10-playback/self-authored.json /tmp/private-dry /tmp/summary-dry.json
node scripts/g10-playback.mjs run examples/g10-playback/self-authored.json /tmp/g10-raw /tmp/g10-sanitized.json
```

`/tmp/g10-raw` must be private, never uploaded to the public repository. `dry-run` writes nothing.
The screenshot is only a human observation, **not** a numeric reference. Candidate measurements (world affine, weighted vertices and PNG) are not evidence of official Spine parity. Independent G6 conformance review and reference attestation are required.

For a verifier-only scene, replace the IR and textures with authorized local files, supply exact source hashes, and include a complete independent schedule. The source 4.1.23 compatibility target and Viewer 4.1.24 are distinct values. Use exact nominal durations from the input IR; do not divide them by 0.29. Speed affects wall-time-to-timeline conversion only.

Suggested private schedules on the 900005 scene, if the clips exist:

- Single clip `1to2`, speed 1× and 0.29×, seek to 0.487 seconds.
- `1to2 → 4to5` on track 0, default mix 0.3 seconds, sample immediately/halfway/complete.
- Interrupt that mix with another clip, then inspect previous clip ID and alpha.
- Enqueue `4to5` behind a nonlooping `1to2` and inspect completion/transition event ordering.
- Repeat while paused and resumed; include track 1 as an independent overlay.

Only `REFERENCE_MATCH` or `REFERENCE_MISMATCH` produced after an independently reviewed official capture may be reported as reference-backed. This G10 candidate tool **always** reports `UNVERIFIED_NO_REFERENCE`; it does not accept a field declaring itself a reference.
