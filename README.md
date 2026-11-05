<div align="center">

<img src="docs/assets/riglyph-logo.png" width="112" height="112" alt="Riglyph logo" />

# Riglyph

**A modular skeletal animation toolkit for the web.**

Convert supported source assets into a portable intermediate representation, then animate and render them through a common TypeScript runtime.

[Get started](docs/getting-started.md) · [Web player](docs/web-player.md) · [React / Next.js](docs/frameworks.md) · [CLI](docs/cli.md) · [Headless rendering](docs/headless-rendering.md) · [Compatibility](docs/compatibility.md) · [Contributing](CONTRIBUTING.md)

</div>

> **Version 0.16.2 · early preview.** The API is evolving. Support is currently limited to the documented input profile; see [compatibility](docs/compatibility.md).

## What it does

Riglyph is an independently developed TypeScript project with a **versioned importer registry**, **Universal Skeleton IR**, animation mixer, CPU renderer, WebGL2 renderer and browser player. Import is performed at build time; the browser player consumes only IR and textures. Developers can build new importers without rewriting the renderer.

The first supported input profile is **Spine Binary 4.1.23** with its associated atlas and image pages. Riglyph uses its own interchange format and player API; it is **not** a general-purpose replacement for all Spine versions or a recreation of the Spine editor.

Riglyph is not affiliated with or endorsed by Esoteric Software. “Spine” is used here solely to identify a supported input format. Use only assets you have permission to convert and distribute.

## Quick start

Install the published packages:

```sh
npm install @riglyph/player-web
npm install --save-dev @riglyph/cli
```

Convert files **you are authorized to use** into web assets:

```sh
npm exec --package=@riglyph/cli -- riglyph probe ./assets/character.skel
npm exec --package=@riglyph/cli -- riglyph convert ./assets/character.skel \
  --atlas ./assets/character.atlas \
  --images ./assets \
  --out-dir ./public/assets/character
```

The output is a `manifest.json`, a `skeleton.ir.json` and `textures/` folder. Serve them from the same web origin, or configure your asset host with appropriate CORS headers.

In browser JavaScript or a React client component:

```ts
import { createPlayer } from '@riglyph/player-web';

const canvas = document.querySelector('canvas')!;
const player = await createPlayer({
  canvas,
  assetUrl: '/assets/character/manifest.json',
  autoResize: true,
  enableControls: true,
});
const first = player.animations()[0];
if (first) player.play(first.id, { loop: true });
player.setCamera({ mode: 'fit-scene', padding: 1 });
// On unmount/disposal: player.dispose();
```

`enableControls` enables canvas wheel/pointer interaction; it does **not** render HTML playback controls. See [framework examples](docs/frameworks.md) for UI integration and cleanup.

## Packages

| npm package | Purpose |
|---|---|
| [`@riglyph/core`](packages/core) | Versioned IR, contracts, validators and errors |
| [`@riglyph/importer-sdk`](packages/importer-sdk) | Importer registry and authoring interfaces |
| [`@riglyph/importer-spine-4.1`](packages/importer-spine-4.1) | Import adapter for the specifically verified 4.1.23 binary profile |
| [`@riglyph/runtime`](packages/runtime) | Version-neutral skeleton instance, tracks and playback |
| [`@riglyph/renderer-webgl2`](packages/renderer-webgl2) | Browser GPU renderer and shared drawing packets |
| [`@riglyph/renderer-cpu`](packages/renderer-cpu) | Software rendering and snapshot verification |
| [`@riglyph/renderer-native`](packages/renderer-native) | Optional Rust CPU renderer bridge |
| [`@riglyph/player-web`](packages/player-web) | Asset loading, animation controls and camera API |
| [`@riglyph/cli`](packages/cli) | Probe, import, convert, validate, inspect and snapshot |

All nine packages are versioned `0.16.2` together. The root project is private to npm; only packages are publishable. IR schema is independently versioned (`1.0.0`).

## Develop locally

Requirements: Node.js 22+ and npm. For this snapshot, vendored TypeScript / development type archives permit core builds without registry access. React and Next.js examples require their own third-party framework packages.

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
npm run pack:check
npm run release:verify
```

Use `npm run smoke:external` to verify that packed packages load from a separate consumer. To run the examples, follow [docs/frameworks.md](docs/frameworks.md). Do **not** add proprietary character assets, original runtime sources or private test corpora to the repository.

## Scope and maturity

This is a **pre-1.0**, evolving API. Unsupported binary versions, JSON exports and editable `.spine` project files are not currently supported. Synthetic conformance tests do not establish full numerical or pixel parity with a third-party renderer. See [compatibility](docs/compatibility.md) and [architecture](docs/architecture.md).

## Project

- [Changelog](CHANGELOG.md) · [Security policy](SECURITY.md) · [Contribution guide](CONTRIBUTING.md)
- [Importer extension guide](docs/creating-importers.md) · [IR versioning](docs/ir-versioning.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

[MIT](LICENSE) for the Riglyph source code. Third-party components retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). No rights to input assets or third-party formats are granted.


## Headless frame and video export (A21)

Riglyph can evaluate a clip and render a full frame sequence with its own CPU
renderer — **without browser, DOM or WebGL**. FFmpeg is optional for video:

```sh
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --out-dir renders/frames --fps 30
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --format mp4 --background '#00FF00' --out renders/green.mp4
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --format webm --alpha --out renders/transparent.webm
```

The reusable `HeadlessRenderEngine` is exported by `@riglyph/renderer-cpu`.
Output frames use precise index-derived timestamps, camera prepass and bounded
per-frame rendering, keeping original IK/Path/deform/clipping behavior.
See [Headless rendering](docs/headless-rendering.md), [FFmpeg video](docs/video-export.md),
and the [minimal example](examples/headless-render/README.md).


## Optional Rust native raster acceleration (A22)

Riglyph can feed its existing evaluated Universal IR draw packets into a
persistent **Rust CPU renderer**. The JavaScript CPU and WebGL2 renderers remain
operational. Use a matching prebuilt native executable with
`@riglyph/renderer-native`, or continue using `--backend js`.

```sh
RIGLYPH_NATIVE_BIN=native/target/release/riglyph-native npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --backend native-cpu --native-threads 4 --out-dir test-output/native
```

See [native installation](docs/native-renderer.md),
[architecture and protocol](docs/native-renderer-architecture.md),
[C ABI](docs/native-renderer-ffi.md), and
[controlled benchmarks](docs/native-renderer-performance.md). Native implementation
v0.1.0, ABI1 and protocol1 are separate from the v0.16.2 package release.
See [v0.16.2 release notes](docs/releases/v0.16.2.md) for geometry fixes and compatibility limits.
