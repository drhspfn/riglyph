# Getting started

Riglyph has two distinct operations: **offline conversion** and **browser playback**. The browser never needs a binary importer.

## Install

After npm publication:

```sh
npm install @riglyph/player-web
npm install --save-dev @riglyph/cli
```

Before publication, build all workspaces using `npm ci && npm run build && npm run pack:check`, then install local `release-packages/riglyph-*.tgz` in the example app; see [framework guide](frameworks.md). Do not assume npm names are already live.

## Prepare assets

You must have the rights to use and redistribute the skeleton and textures. The currently supported input is **Spine Binary 4.1.23** only; `probe` reports source identification separately from importer support.

```sh
npm exec --package=@riglyph/cli -- riglyph probe ./assets/demo.skel
npm exec --package=@riglyph/cli -- riglyph convert ./assets/demo.skel --atlas ./assets/demo.atlas --images ./assets --out-dir ./public/assets/demo
npm exec --package=@riglyph/cli -- riglyph validate ./public/assets/demo/skeleton.ir.json
```

Windows PowerShell can use the same commands on a single line. On repeated conversions add `--overwrite` deliberately. The directory should look like:

```text
public/assets/demo/
  manifest.json
  skeleton.ir.json
  textures/
    <atlas-pages>.png
```

The manifest references the IR and texture pages relatively; serve the entire directory. Treat the output as a generated, immutable deployment asset. For CDN hosting, make sure access and CORS policies allow `fetch` and texture loading.

## Embed a canvas

```html
<canvas id="scene" width="960" height="540"></canvas>
```

```ts
import { createPlayer } from '@riglyph/player-web';
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const player = await createPlayer({canvas, assetUrl:'/assets/demo/manifest.json', enableControls:true, autoResize:true});
const clips = player.animations();
if (clips.length) player.play(clips[0].id, {loop:true});
player.setCamera({mode:'fit-scene', padding:1});
// Cleanup on page removal:
player.dispose();
```

For custom controls, query `player.animations()` and `player.skins()`, call `pause()` / `resume()` / `seek(seconds)` / `setSpeed(factor)`, and subscribe with `player.on(...)`. Browser controls are *not* generated automatically. See [web player](web-player.md).

## Troubleshooting

- `UNSUPPORTED_*`: inspect `probe` and [compatibility](compatibility.md), do not force another adapter.
- Missing PNG: atlas page filenames and case must match files in the image directory.
- `OUTPUT_EXISTS`: explicitly pass `--overwrite`, or choose a new output directory.
- Blank canvas: inspect browser network requests for `manifest.json`, IR and PNG, verify WebGL2 support, and check the browser console.
- Camera black bars: `fit-scene` preserves aspect ratio; `padding:1` removes extra margin but cannot remove letterboxing caused by different aspect ratios.
