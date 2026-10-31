# Changelog

## 0.15.1 — preview candidate (unpublished)

- Expose `setCamera({mode: 'fit-scene', padding: 1})` with backward-compatible default padding `1.25` and React controls regression checks.
- Repair Windows npm invocation and transactional `convert --overwrite` output handling.
- Correct 90°/270° packed-region UV handedness in shared draw packet projection; 0°/180° unchanged.
- Preserve original/untrimmed mesh UV, single trimming conversion, page selection, no automatic clamp.
- Add A18 numeric contract regressions for region, mesh, linked mesh, multi-page and rotated packed dimensions.
- No changes to Spine Binary 4.1.23 decoding, IR serialization, animation timing, transforms, or clipping.
- Public publication remains BLOCKED pending independent G1/G3 rerun and owner/legal/framework gates.

## 0.15.0 — unpublished preview candidate

- Rename eight npm packages to `@riglyph/*` and provide `riglyph` CLI executable.
- Preserve existing Spine Binary **4.1.23** plugin and Universal IR 1.0.0.
- Provide build-time conversion from `.skel + .atlas + PNG` into portable Web Player manifest.
- Add release verification, staged artifacts, clean GitHub candidate, CI and strictly gated npm Trusted Publishing runbook.
- Preserve G9/G10 playback mixing, clipping self-end and trimmed-mesh UV regressions.
- No claim of official G2/G3 parity or public publication.
