# Riglyph engineering rules

Universal IR is the source-independent interchange contract. TypeScript owns
animation evaluation and canonical DrawPackets. Rust currently rasterizes RGP1
packets; it does not parse source skeletons or evaluate animations. JS CPU,
WebGL2 and Rust must receive equivalent geometry.

- Fix shared geometry in the shared packet stage, never conceal it in one backend.
- Source-format changes require importer and IR regression tests.
- Animation changes require Transform/IK/Path reference suites and repeated seeks.
- Clipping changes require convex/concave, weighted/deformed, reflected,
  lifecycle and invalid-geometry tests. Keep strict rejection and actionable diagnostics.
- Renderer changes require JS/native pixel parity and actual browser regressions.
- Never weaken independent goldens or tolerances to obtain a passing build.
  Distinguish black-box reference observations from self-authored analytic tests.
- Never publish private game assets, diagnostic geometry or reference executables.
  Never copy or transplant official Spine runtime implementation code.
- Run full CI before requesting merge. Do not claim a completed fix without an
  end-to-end render of the reproduction and explicitly documented limitations.
- Bug-fix PRs do not authorize version bumps, npm publication, GitHub Releases,
  publication workflow changes or automatic merging.

See [rendering conformance](docs/rendering-conformance.md) for ownership,
compatibility policy, diagnostics, reference provenance and acceptance checks.
