# Web player API

The browser package `@riglyph/player-web` loads `manifest.json` and its referenced IR and texture pages. Import/conversion runs in the CLI, outside the browser.

```ts
import {createPlayer} from '@riglyph/player-web';
const player = await createPlayer({
  canvas: document.querySelector('canvas')!,
  assetUrl:'/assets/demo/manifest.json',
  autoResize:true,
  enableControls:true,
});

const availableClips = player.animations();
if (availableClips.length) player.play(availableClips[0].id,{loop:true});
player.setSpeed(1);
player.setDefaultMix(0.3);
player.setCamera({mode:'fit-scene', padding:1});
const unsub = player.on('event', event => console.log(event));
// ...
unsub();
player.dispose();
```

## Playback

`play`, `setAnimation`, `transitionTo`, `enqueue`, `clearQueue`, `clearTrack`, `pause`, `resume`, `seek`, `setLoop`, `setSpeed`, `setDefaultMix` and `advance` operate on a shared version-neutral AnimationPlayer. Event listeners receive `start`, `transition`, `complete`, `loop`, `event` and `error` notices; `.on(type, handler)` returns an unsubscribe function. Consult TypeScript declarations for exact options.

For testing and diagnostics: `player.status`, `player.diagnostics()`, `player.captureFixedFrame(...)`. Fixed-frame capture should not mutate the live playback queue or current camera.

## Camera and canvas

```ts
player.setCamera({mode:'fit-scene',padding:1});    // tight fit, no extra margin
player.setCamera({mode:'fit-scene'});             // backwards-compatible 1.25 padding
player.setCamera({mode:'fit-selection',slotId:'...'});
player.zoom(0.8); // zoom in (viewport gets smaller)
player.pan(20,0);
```

Camera padding is a positive finite factor. `fit-scene` preserves aspect ratio, recomputes on resize, and may still letterbox. `zoom` and `pan` switch to fixed mode, disabling auto-fit until `setCamera` is called again. `enableControls:true` adds canvas wheel zoom/drag pan only; design your own playback toolbar in React or vanilla JS.

## Hosting and lifecycle

The `assetUrl` points to a generated manifest containing relative paths. Serve its IR and PNG pages from the same origin or an appropriately configured CDN. On component unmount or changing asset URLs, call `dispose()` on the old player. Avoid constructing WebGL2 renderers on the server. For complete examples see [getting started](getting-started.md) and [frameworks](frameworks.md).

## Compatibility

Only the importer plugin for exact Spine Binary **4.1.23** is shipped in 0.15.1. The Web Player itself consumes version-neutral IR 1.0.0. The project does not claim official runtime equivalence; see [compatibility](compatibility.md).
