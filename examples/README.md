# Framework examples

These examples demonstrate consuming the public Riglyph packages, **not** bundling the editor/runtime source.

- `react/`: React + Vite controlled player, animation selector, timeline, speed, skin, zoom and fit. Uses local 0.15.1 `.tgz` package archives when run inside this repository.
- `nextjs/`: Next.js App Router integration, dynamic client initialization of WebGL, and SSR/hydration check.
- `vanilla-web/`: Plain browser JavaScript example.

Build the root project (`npm ci && npm run build && npm run pack:check`) before installing example dependencies. The examples require React/Next/Vite dependencies available via npm. Put **licensed** converted IR/PNG/manifest files under each example's `public/assets/` directory. See [framework guide](../docs/frameworks.md).

Do not ship third-party game assets as demonstration content. The committed sample scene is for self-authored/synthetic testing only.
