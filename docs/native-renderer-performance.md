# Native renderer benchmark methodology

The historical 800x600, 161-frame, ~90 second Ryzen 5 3600 observation is not a controlled baseline. Performance claims require measurements of *identical frames, textures, camera and sampling* on the same hardware.

Run after Cargo release build and npm build:

    RIGLYPH_NATIVE_BIN=native/target/release/riglyph-native BENCH_WIDTH=800 BENCH_HEIGHT=600 BENCH_REPS=12 node tools/native-benchmarks/benchmark.mjs

The script warms up both implementations, runs multiple repeats, and reports p50/p95 for TypeScript animation, draw-packet preparation, JavaScript raster, Rust raster+binary IPC+readback (1 and 4 threads), matched full frame pipeline, and PNG compression. It records peak RSS and matches native RGBA against the JS pixel reference on every sample. The Rust-only rasterization measurement is never compared to a full JS export for speedup.

Run native export smoke to measure complete PNG and FFmpeg video separately. CI-runners are not Ryzen 5 3600; label results by host. More complex scenes may have greater speedups than the small synthetic fixture. No claim of faster performance on the user's hardware without matched measurements there.

CPU raster backend is independent of the existing animation runtime. Native 0.1.0 / ABI1 / protocol1 remain separately versioned from the future v0.16.1 package release.