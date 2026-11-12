# Changelog

## 0.16.3 — Spine import fix

- Treat the animation-wide timeline value as a capacity hint, allowing valid Spine Binary 4.1.23 imports with differing decoded counts.
- Preserve structural validation and resource limits; add seven regression tests checked against independent reference observations.

## 0.16.2 — Geometry and clipping fixes

- Correct selective transform inheritance under nonuniform scale, reflection and shear.
- Harden shared clipping validation and triangulation; preserve strict defaults and add explicit compatible even-odd coverage with diagnostics.
- Add public geometry policy callbacks and CLI `--clipping-policy` / `--debug-geometry` options.
- Verify complete dynamic clipping sequences across JS, WebGL2 and Rust; fix Chromium/Ubuntu mirror CI installation stalls.
- Retain Spine Binary 4.1.23, IR 1.0.0, native 0.1.0, ABI1 and protocol1. See [release notes](docs/releases/v0.16.2.md) for source-geometry limitations and validation.

## 0.16.0 — Spine 4.1 Constraint Completion (release candidate)

- Complete World/Local × Absolute/Relative Transform Constraints and six independent mixing channels (A19).
- Complete targeted one- and two-bone IK: bend direction, softness, compression/stretching, uniform scaling, partial mixing and reflected/nonuniform transforms (A20).
- Complete targeted Path Constraints: weighted/unweighted paths, deform timelines, open/closed geometry, constant/nonconstant speed, position/spacing/rotation modes and dynamic attachments.
- Fix ordered Bézier arc sampling for negative spacing, repeated closed-path wraps and near-coincident chords.
- Preserve applied/world matrices across mixed Transform → IK → Path chains; add deterministic repeat-seek and edge regressions.
- Keep A18 atlas quarter-turn UV correction, Windows tooling fixes, browser, CPU/WebGL2 and React/Next.js regressions.
- A20 final PR verification: 266/266 independent numeric IK/Path observations; 439/439 tests per CI workspace matrix (Ubuntu/Windows, Node 22/24), all six jobs passing on its final HEAD. Newer release commit requires fresh CI.
- The user has also confirmed successful local cubie playback; this is not an independently recorded release CI test.
- Supported import profile remains Spine Binary 4.1.23. Full official visual parity and arbitrary third-party Spine asset compatibility are not claimed.


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
