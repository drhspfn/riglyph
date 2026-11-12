# @riglyph/renderer-cpu

CPU software renderer and snapshot tools for Riglyph scenes.

**Version:** 0.16.3 (pre-1.0 preview). Part of the [Riglyph toolkit](https://github.com/drhspfn/riglyph).

## Installation

```sh
npm install @riglyph/renderer-cpu
```

Install only after the corresponding npm package is published. Local checkout builds use `npm run build` and `npm run pack:check`; packages are released together at the same version.

## Documentation

See [Riglyph documentation](https://github.com/drhspfn/riglyph/blob/main/docs/architecture.md) and the [getting started guide](https://github.com/drhspfn/riglyph/blob/main/docs/getting-started.md).

Riglyph is an independent project. The current import profile is restricted to **Spine Binary 4.1.23**; there is no claim of all-version compatibility or official runtime parity. Rights to user assets remain with their owners.


## Browser-free animation sequences

`HeadlessRenderEngine` evaluates the same Universal IR runtime and draw-packet
pipeline as WebGL2; it rasterizes PNG-ready RGBA `Uint8Array` frames using
only the CPU. It exposes `renderFrame({clipId,timeSec})` and streaming
`renderSequence({clipId,startSec,endSec,onFrame,signal})`, plus stable/per-frame
fit cameras, follow/fixed cameras and premultiplied-alpha-safe supersampling.
No DOM, WebGL, FFmpeg or CLI process arguments are required by this package.
For FFmpeg adapters, use `@riglyph/cli`.

See [headless rendering](https://github.com/drhspfn/riglyph/blob/main/docs/headless-rendering.md).
