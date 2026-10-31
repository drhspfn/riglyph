# Third-party notices (candidate; review before release)

| Component | Version | Usage | Declared license, confirm before shipping |
|---|---|---|---|
| TypeScript (vendored npm tarball) | 5.8.3 | build/dev only | Apache-2.0 |
| @types/node | 25.1.0 | build/dev only | MIT |
| undici-types | 7.16.0 | build/dev only | MIT |
| Node.js | >=22 | developer/CLI runtime | Node.js license (external, not bundled) |
| React/Vite/Next | externally installed example consumers | samples only | verify upstream licenses and versions when installed |

Riglyph production packages depend only on other `@riglyph/*` packages. The project does not distribute the official Spine Runtime, closed character assets or official viewer. SPDX report is in `release-artifacts` and subject to manual audit; this list is not legal approval.
