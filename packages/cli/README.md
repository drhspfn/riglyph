# @riglyph/cli

Riglyph command-line importer, converter, inspector and snapshot utility.

**Version:** 0.16.0 (pre-1.0 preview). Part of the [Riglyph toolkit](https://github.com/drhspfn/riglyph).

## Installation

```sh
npm install --save-dev @riglyph/cli
```

Install only after the corresponding npm package is published. Local checkout builds use `npm run build` and `npm run pack:check`; packages are released together at the same version.

## Documentation

See [Riglyph documentation](https://github.com/drhspfn/riglyph/blob/main/docs/cli.md) and the [getting started guide](https://github.com/drhspfn/riglyph/blob/main/docs/getting-started.md).

Riglyph is an independent project. The current import profile is restricted to **Spine Binary 4.1.23**; there is no claim of all-version compatibility or official runtime parity. Rights to user assets remain with their owners.


## Headless rendering

`riglyph render <skeleton.ir.json> --images ./textures --clip idle --out-dir frames`
creates RGBA PNG frames without a browser. Use `--format mp4 --out movie.mp4`
or `--format webm --alpha --out movie.webm` with a supported FFmpeg build.
Additional Node APIs: `runRenderCli`, `parseRenderOptions`, `encodeVideoFrames`,
`probeFFmpeg`.

See [headless rendering](https://github.com/drhspfn/riglyph/blob/main/docs/headless-rendering.md)
and [video export](https://github.com/drhspfn/riglyph/blob/main/docs/video-export.md).
