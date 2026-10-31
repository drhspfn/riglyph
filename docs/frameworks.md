# React, Vite and Next.js

The **same** `@riglyph/player-web` works in vanilla browser code, React and Next.js client components. Create and dispose one WebPlayer per canvas/asset lifecycle; never instantiate WebGL during SSR.

## React / Vite

After release:

```sh
npm install @riglyph/player-web
```

Place the generated asset directory under `public/assets/demo`, then create `RiglyphCanvas.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { WebPlayer } from '@riglyph/player-web';

export function RiglyphCanvas({ assetUrl, clip }: { assetUrl: string; clip?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let player: WebPlayer | undefined;
    void import('@riglyph/player-web').then(async ({ createPlayer }) => {
      if (!canvas.current || cancelled) return;
      const instance = await createPlayer({ canvas: canvas.current, assetUrl, autoResize: true, enableControls: true });
      if (cancelled) { instance.dispose(); return; }
      player = instance;
      instance.setCamera({ mode: 'fit-scene', padding: 1 });
      const animation = instance.animations().find(a => a.id === clip || a.name === clip) ?? instance.animations()[0];
      if (animation) instance.play(animation.id, { loop: true });
    }).catch(console.error);
    return () => { cancelled = true; player?.dispose(); };
  }, [assetUrl, clip]);
  return <canvas ref={canvas} width={960} height={540} style={{width:'100%', aspectRatio:'16 / 9', display:'block'}} />;
}
```

For live animation changes without recreating the player, keep its instance in a ref and call `transitionTo(...)` from a separate effect or event handler. See `examples/react/src/main.tsx` for a control-rich demo. Ensure canvas CSS size and intrinsic pixel size are sensible; `autoResize` observes changes.

### Testing the source checkout before npm publication

```sh
npm ci --ignore-scripts
npm run build
npm run pack:check
cd examples/react
npm install
npm run typecheck
npm run build
npm run dev
```

The example installs local release packages and is intended to run from the repository. Check its `package.json` for any local development override and ensure final external-consumer verification uses `.tgz` packages, not direct source imports.

## Next.js App Router

The Canvas must be rendered from a client component:

```tsx
'use client';
import { RiglyphCanvas } from './RiglyphCanvas';
export default function ScenePage() {
  return <RiglyphCanvas assetUrl="/assets/demo/manifest.json" clip="idle" />;
}
```

The `RiglyphCanvas` implementation above uses a dynamic import inside `useEffect`, so WebGL-dependent code is initialized only in the browser. Place the generated files at `public/assets/demo`. Run `npm run typecheck && npm run build` from `examples/nextjs` and test hydration using a browser; a successful SSR compile alone is insufficient.

## Controlled API

- `player.animations()`, `player.skins()` — discover available options.
- `play(id,{loop:true})`, `pause()`, `resume()`, `seek(seconds)` — playback.
- `setSpeed(factor)`, `setDefaultMix(seconds)`, `transitionTo(id,{track:0,mixDurationSec:0.3})` — timing/mixing.
- `setSkin(id)`, `setCamera({mode:'fit-scene',padding:1})`, `zoom(factor)`, `pan(dx,dy)` — visual settings.
- `player.status` and `player.diagnostics()` — reactive UI updates.

`enableControls:true` is pointer/wheel camera input, **not** a generated toolbar. `padding:1.25` is the backwards-compatible fit default; `padding:1` removes deliberate camera margin. Remaining bars may be geometrically necessary to preserve aspect ratio.
