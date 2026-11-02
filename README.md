<div align="center">

<img src="docs/assets/riglyph-logo.png" width="112" height="112" alt="Riglyph logo" />

# Riglyph

**A modular skeletal animation toolkit for the web.**

Convert supported source assets into a portable intermediate representation, then animate and render them through a common TypeScript runtime.

[Get started](docs/getting-started.md) · [Web player](docs/web-player.md) · [React / Next.js](docs/frameworks.md) · [CLI](docs/cli.md) · [Compatibility](docs/compatibility.md) · [Contributing](CONTRIBUTING.md)

</div>

> **Version 0.16.0 · early preview.** The API is evolving. Support is currently limited to the documented input profile; see [compatibility](docs/compatibility.md).

## What it does

Riglyph is an independently developed TypeScript project with a **versioned importer registry**, **Universal Skeleton IR**, animation mixer, CPU renderer, WebGL2 renderer and browser player. Import is performed at build time; the browser player consumes only IR and textures. Developers can build new importers without rewriting the renderer.

The first supported input profile is **Spine Binary 4.1.23** with its associated atlas and image pages. Riglyph uses its own interchange format and player API; it is **not** a general-purpose replacement for all Spine versions or a recreation of the Spine editor.

Riglyph is not affiliated with or endorsed by Esoteric Software. “Spine” is used here solely to identify a supported input format. Use only assets you have permission to convert and distribute.

## Quick start

After the eight packages are published:

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
| [`@riglyph/player-web`](packages/player-web) | Asset loading, animation controls and camera API |
| [`@riglyph/cli`](packages/cli) | Probe, import, convert, validate, inspect and snapshot |

All eight packages are versioned `0.16.0` together. The root project is private to npm; only packages are publishable. IR schema is independently versioned (`1.0.0`).

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
