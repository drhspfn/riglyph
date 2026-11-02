# FFmpeg video export (A21)

Video is optional. PNG sequences are generated directly by Riglyph without FFmpeg. MP4 and WebM consume raw `rgba` frames from the same **headless CPU** path via FFmpeg stdin with stream backpressure: no browser, WebGL, PNG intermediates or unbounded frame accumulation.

## Installation and diagnostics

Install **FFmpeg + ffprobe** including `libx264` and `libvpx-vp9` (and an alpha-capable VP9 decoder for transparent WebM verification). Check `ffmpeg -encoders` and `ffprobe -version`. Set `--ffmpeg-path` to a full executable path (including spaces on Windows) or `RIGLYPH_FFMPEG` as an environment variable; otherwise it uses `ffmpeg` from PATH. Use `--ffprobe-path` when ffprobe lives elsewhere. The chosen encoder is checked before rendering and failures never silently fall back to another format.

## H.264 MP4

```powershell
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --fps 30 --width 800 --height 600 --format mp4 --background "#00FF00" --crf 18 --preset medium --out renders/green.mp4
```

```sh
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --fps 30 --width 800 --height 600 --format mp4 --background '#00FF00' --crf 18 --preset medium --out renders/green.mp4
```

MP4 encodes with `libx264`, `yuv420p`, `+faststart` and configurable CRF/preset/bitrate. **H.264 MP4 cannot carry the source alpha** in this output profile; the CPU renderer composites RGBA over the solid background (default black) *before* FFmpeg conversion. Use green `#00FF00` or blue `#0000FF` for chroma key. `--alpha` with MP4 fails explicitly. For broad consumer compatibility the YUV420P encode requires **even width/height**.

## VP9 WebM and alpha

```powershell
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --fps 30 --width 800 --height 600 --format webm --alpha --crf 28 --preset good --out renders/transparent.webm
```

```sh
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --fps 30 --width 800 --height 600 --format webm --alpha --crf 28 --preset good --out renders/transparent.webm
```

For alpha WebM the encoder uses `libvpx-vp9`, `yuva420p` and `-auto-alt-ref 0`, plus `alpha_mode=1` metadata. A successful FFmpeg exit is **not sufficient**: output validation uses `ffprobe` to check VP9 codec, dimensions, FPS, decoded frame count, duration and alpha metadata, and invokes the `libvpx-vp9` decoder into RGBA to verify preserved transparency when the first frame contains transparent pixels. Encoding fails if metadata or the available decoder cannot preserve alpha. **Not all WebM players and native/accelerated decoders preserve VP9 alpha.** Test the actual deployment browser/player.

Without `--alpha`, WebM is solid-background YUV420P; set `--background '#RRGGBB'`.

## Video validation

The CLI verifies:
- requested H.264/VP9 codec;
- exact dimensions and encoded frame count from `ffprobe -count_frames`;
- FPS and duration against the deterministic frame scheduler;
- WebM alpha metadata and a decoded RGBA pixel where available.

When encoding fails, FFmpeg stderr is limited to 16 KiB, the partially written staging file is deleted, the child process is terminated and no successful output is produced. `--overwrite` is required to replace an existing output. Abort using Ctrl+C or the programmatic `AbortSignal`.

The A21 CI video matrix installs FFmpeg explicitly and validates generated MP4 and WebM on Ubuntu/Windows Node 22/24. It retains resulting files as GitHub Actions artifacts rather than treating missing encoders as PASS. See [headless rendering](headless-rendering.md).

## Limitations

The CPU renderer supports RGBA PNG image assets accepted by Riglyph's existing 8-bit noninterlaced PNG decoder. Odd dimensions are supported for PNG, but not for YUV420P videos. Encode-time RAM is bounded to the current frame plus FFmpeg's internal buffers, with backpressure. This output profile has no audio encoder or audio-muxing API. Numerical compatibility with every external Spine file or complete visual parity is not claimed.
