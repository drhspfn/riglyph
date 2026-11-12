# Native renderer benchmark methodology

The historical 800x600, 161-frame, ~90 second Ryzen 5 3600 observation is not a controlled baseline. Performance claims require measurements of *identical frames, textures, camera and sampling* on the same hardware.

Run after Cargo release build and npm build:

    RIGLYPH_NATIVE_BIN=native/target/release/riglyph-native BENCH_WIDTH=800 BENCH_HEIGHT=600 BENCH_REPS=12 node tools/native-benchmarks/benchmark.mjs

The script warms up both implementations, runs multiple repeats, and reports p50/p95 for TypeScript animation, draw-packet preparation, JavaScript raster, Rust raster+binary IPC+readback (1 and 4 threads), matched full frame pipeline, and PNG compression. It records peak RSS and matches native RGBA against the JS pixel reference on every sample. The Rust-only rasterization measurement is never compared to a full JS export for speedup.

Run native export smoke to measure complete PNG and FFmpeg video separately. CI-runners are not Ryzen 5 3600; label results by host. More complex scenes may have greater speedups than the small synthetic fixture. No claim of faster performance on the user's hardware without matched measurements there.

CPU raster backend is independent of the existing animation runtime. Native 0.1.0 / ABI1 / protocol1 remain separately versioned from the v0.16.3 package release.

## Measured CI results — 2026-11-02

Source: [native CI run #41493027255](https://github.com/drhspfn/riglyph/actions/runs/41493027255), **Linux x64 / Node 24.22.1**; 800×600, 30 FPS, authored minimal Universal IR, nearest sampling, 5 warmup frames and 12 timed frame repetitions. Measurements are from an ephemeral GitHub runner, **not** from a Ryzen 5 3600.

| Equivalent measurement | JavaScript | Rust | Interpretation |
|---|---:|---:|---|
| Median raster stage (one frame) | 11.88 ms | 11.41 ms (one Rust thread, includes IPC) | Approximately comparable |
| Median raster stage (four Rust threads, includes IPC) | 11.88 ms | 13.38 ms | Four threads slower on tiny geometry |
| p95 raster stage | 133.63 ms | 14.63 ms (four threads) | JS exhibits long-tail pauses on this sample |
| Complete PNG sequence, five 800×600 frames | 477.01 ms | 124.06 ms | **3.85× faster** in this measured run |
| Complete H.264 video, five frames | 692.27 ms | 370.29 ms | **1.87× faster** in this measured run |

Other measured medians: animation evaluation **0.048 ms**, DrawPacket generation **0.028 ms**, PNG compression **2.177 ms** per frame. Process peak RSS **188,100,608 bytes** across the benchmark process. That RSS includes Node, texture/packet buffers, Rust child processes and two concurrently running renderer instances, so it must **not** be presented as the native backend's isolated allocation or peak memory use.

The observed median full-frame pose + packet + raster evaluation was **11.98 ms JS versus 13.46 ms native (four threads)**, meaning this metric does **not** demonstrate a native speedup. The PNG and video results differ in part due to warmup, process scheduling and variation in JS rasterization. The benchmark uses one small synthetic scene; do not extrapolate the 3.85× result to all assets.

The benchmark currently reports peak RSS rather than exact malloc/free counts; native allocator event counts remain uninstrumented. No performance result has been recorded yet for the user's 161-frame character asset on a Ryzen 5 3600.

All benchmark samples first compare the same frame through JS and Rust and fail if any RGBA component differs by more than 1/255. The full A21 PNG/H.264/VP9 integration is checked in native CI independently of the timing experiment.
