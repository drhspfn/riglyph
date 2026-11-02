# Riglyph Native Renderer (A22)

An optional Rust CPU rasterization backend for Riglyph. TypeScript continues to own Universal IR, AnimationPlayer, SkeletonInstance, Transform/IK/Path constraints, textures, draw order, clipping triangulation and camera. Rust consumes canonical DrawPackets over RGP1 v1 and returns RGBA8. It does not parse Spine or evaluate animations.

## Consumer installation

Supported targets: Windows x64, Linux x64, macOS ARM64. Download an approved matching archive containing the shared library and riglyph-native CLI. No Rust compiler is required on consumer machines. Set RIGLYPH_NATIVE_BIN to the native executable. The Node package is @riglyph/renderer-native.

PowerShell example:

    $env:RIGLYPH_NATIVE_BIN="C:\Riglyph Native\riglyph-native.exe"
    riglyph render character.ir.json --images ./textures --clip idle --backend native-cpu --native-threads 4 --fps 30 --width 800 --height 600 --out-dir ./frames

Linux/macOS example:

    RIGLYPH_NATIVE_BIN="$PWD/native/target/release/riglyph-native" riglyph render character.ir.json --images ./textures --clip idle --backend native-cpu --native-threads 4 --out-dir ./frames

Backend choices: js (existing CPU), native-cpu (explicit errors if unavailable), auto (select compatible native, otherwise log fallback to JS). All A21 PNG/MP4/WebM, transparency, cameras, FPS, progress and cancellation remain available.

## Scope and limitations

Native v0.1.0 / C ABI v1 / packet protocol v1. Target release label v0.16.1, but version bump and publishing require review. Rust handles only rasterization; C/Python clients must provide draw packets themselves. The current Rust backend enforces 8,388,608 pixels per frame and 512 MiB cached textures. CPU tiles preserve packet order; optional wgpu could be introduced in a later release, but this PR contains no fake GPU backend.

See native-renderer-architecture.md, native-renderer-ffi.md, native-renderer-performance.md and examples/native-renderer/.