# Headless animation rendering (A21)

Riglyph renders **Universal IR** directly with `SkeletonInstance`, `prepareDrawPackets` and the CPU rasterizer. No Chromium, WebGL context, DOM or browser is launched. PNG output requires no FFmpeg.

## Quick start

Run after `npm ci && npm run build` from the repository root, or use the published `riglyph` CLI:

```powershell
npm run cli -- render ./fixtures/minimal.json --images ./fixtures --clip rotate90 --out-dir ./renders/demo --fps 30 --width 800 --height 600
```

```sh
npm run cli -- render ./fixtures/minimal.json --images ./fixtures --clip rotate90 --out-dir ./renders/demo --fps 30 --width 800 --height 600
```

Output is a directory of independently decodable, correctly ordered RGBA PNGs (`frame_000000.png`, …) and `render-manifest.json`, containing `format: riglyph-render-sequence-v1`, frame count, clip, source identity, camera, quality and completion status.

### Exact time semantics

For every output frame index `i`, the animation is independently sampled at `startSec + i / fps`. The default interval is **half-open** `[startSec,endSec)` — 3 seconds at 60 FPS gives exactly 180 frames, and the pose at exactly 3.0 is not silently appended. `--include-end` explicitly adds the matching end sample when the endpoint falls on the frame grid. An empty half-open interval is rejected. A timestamp remains independent of the preceding render; clip loops are evaluated from absolute time.

`--playback-speed` scales source animation time. `--loop` repeats the clip; `--loop-count` derives the range from its duration when `--end` is omitted. Use `--start`/`--end` to select custom ranges. `--fps` accepts finite fractional values. The renderer computes its maximum frame count **before** starting output; the default limit is 200,000 frames.

### Render camera

- `--camera fit-scene` (default): automatically fit visible packets.
- `--camera fit-selection --camera-slot slot-id`: fit packets from one selected slot; a missing/hidden selection is an explicit error.
- `--camera fixed --camera-x 0 --camera-y 0`: fixed world-space viewport. Programmatic `worldWidth` defaults to 50 world units.
- `--camera follow --camera-target bone-id`: follow an active bone in world space.

`--camera-fit animation` (default) performs a **deterministic per-frame sampling prepass** and fits all sampled poses to one stable camera. This is a sampled envelope, **not a guaranteed continuous-time mathematical extremum**. `start` fixes the first pose, `frame` refits each frame. `--camera-padding` and `--camera-scale` adjust framing (increased scale zooms in); X/Y are world-space offsets. The viewport preserves output aspect ratio and never changes the skeleton pose.

### Quality, alpha and resources

`--sampling nearest|linear` uses the existing CPU texture sampler. `--supersampling 1|2|4` rasterizes at the larger resolution then downsamples by **averaging premultiplied color and alpha**, avoiding transparent-edge halos. `--png-compression 0..9` controls lossless zlib compression. Transparent PNG output is the default; `--background '#00FF00'` uses a solid color; `--alpha` requests transparency for formats that support it.

The CPU rasterizer limits intermediate surfaces to 8,388,608 pixels; memory budgeting defaults to 256 MiB (`--max-bytes`), with no frame accumulation. Frames are rasterized, encoded and written sequentially. PNG output is staged in a sibling directory and committed only after **all** frames and the manifest are written. `--overwrite` uses the existing directory backup/rollback transaction. Any failure or Ctrl+C leaves no output marked successful.

### Timeline and multiple tracks

A JSON config supports a deterministic serialized `timeline` of absolute-time track events. Each event has `atSec`, `track`, `clipId`, `loop`, `mixDurationSec`. Events are ordered by timestamp/track. The export invokes the existing `AnimationPlayer` mixer, replaying the event configuration to each render timestamp, rather than reimplementing mixing or queues:

```json
{
  "images": "./fixtures",
  "clip": "rotate90",
  "width": 640,
  "height": 640,
  "fps": 24,
  "start": 0,
  "end": 2,
  "outDir": "./renders/config",
  "camera": {"mode":"fit-scene","fit":"animation","padding":1.1},
  "quality": {"sampling":"linear","supersampling":1},
  "timeline": [
    {"atSec":0,"track":0,"clipId":"rotate90","loop":true,"mixDurationSec":0}
  ]
}
```

Run `riglyph render ./fixtures/minimal.json --config render.json --fps 30`. Explicit command-line options override JSON config; unknown flags/config properties are rejected.

### Programmatic API

```ts
import {HeadlessRenderEngine} from '@riglyph/renderer-cpu';

// ir: validated Universal IR; textures: Map<pageId, RawTexture>
const engine = new HeadlessRenderEngine({
  ir, textures, width:1920,height:1080,fps:60,
  camera:{mode:'fit-scene',fit:'animation',padding:1.1},
  background:{mode:'transparent'},
  quality:{sampling:'linear',supersampling:1}
});
const frame = await engine.renderFrame({clipId:'idle',timeSec:1.5});
await engine.renderSequence({
  clipId:'idle',startSec:0,endSec:3,fps:60,
  onFrame:async (frame,index,total)=>{/* encode/write each RGBA buffer */},
  onProgress:({phase,frame,totalFrames})=>{},
  signal:abortController.signal
});
```

The engine has no Node I/O, ffmpeg, process argument or DOM dependency; output adapters are separated into `@riglyph/cli`. Multi-frame output never returns a giant array. Use `AbortSignal` to cancel.

### Errors

Nonfinite dimensions/FPS, oversized surfaces, bad image pages, absent clips, inactive camera targets, unknown parameters, output collisions and invalid frame ranges all produce structured Riglyph diagnostics. CLI exit status is nonzero on failure; `--progress json|text|none` controls stderr progress without mixing with stdout output metadata.

Video formats and codec limitations: [video export](video-export.md).
