# Headless rendering example (A21)

This example uses only the existing rights-safe `fixtures/minimal.json` and its
`fixtures/synthetic-example.png` texture. It does not require Chromium or WebGL.

From the repository root:

```sh
npm ci --ignore-scripts && npm run build
node examples/headless-render/render.mjs
```

The example writes 12 independent RGBA PNG frames to `test-output/headless-example/`.

Equivalent CLI command:

```sh
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --fps 12 --width 128 --height 128 --out-dir test-output/frames
```

To make a solid green-screen H.264 file with FFmpeg installed:

```sh
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --fps 12 --width 128 --height 128 --format mp4 --background '#00FF00' --out test-output/demo.mp4
```

To make transparent VP9 WebM:

```sh
npm run cli -- render fixtures/minimal.json --images fixtures --clip rotate90 --fps 12 --width 128 --height 128 --format webm --alpha --out test-output/demo.webm
```

Windows PowerShell uses the same commands with double quotes around `"#00FF00"`.

See [headless rendering](../../docs/headless-rendering.md) and
[FFmpeg validation](../../docs/video-export.md).
