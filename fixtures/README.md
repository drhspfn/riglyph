# Self-authored fixture set

- `minimal.json`: original Agent B canonical IR exercise — one root, one textured quad, one authored 90° rotation clip. Designed directly from the IR schema; not a copy of the handoff JSON sample.
- `synthetic-example.png`: four solid authored pixel colors, 2×2 RGBA PNG (no game art).
- `atlas-demo.atlas`: self-authored text to exercise PNG page/region resolution.
- `synthetic-wrapper.cleanroom.json`: independently authored test-source envelope for the second adapter. Generated from `minimal.json`; no real Spine format supported.
- `synthetic-header-only.bin`: independently generated header/string table/count bytes per documented functional format; **no valid Spine skeleton body**.

All runtime/mesh/clip numerical tests construct or mutate these self-authored fixtures in `tests/`. No original runtime, third-party port, original game binary or proprietary texture is included.
