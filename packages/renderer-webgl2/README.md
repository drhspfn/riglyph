# @riglyph/renderer-webgl2

WebGL2 renderer for Riglyph draw packets and skeletal scenes.

`prepareDrawPackets(instance, {clippingPolicy: 'strict' | 'compatible'})` owns
shared CPU geometry for all backends. Strict is the default. Compatible uses
explicit even-odd fill for proper crossings and emits structured warnings through
`onGeometryWarning`; `onGeometryDiagnostic` captures geometry samples.
See [clipping contracts](https://github.com/drhspfn/riglyph/blob/main/docs/rendering-conformance.md).

**Version:** 0.15.1 (pre-1.0 preview). Part of the [Riglyph toolkit](https://github.com/drhspfn/riglyph).

## Installation

```sh
npm install @riglyph/renderer-webgl2
```

Install only after the corresponding npm package is published. Local checkout builds use `npm run build` and `npm run pack:check`; packages are released together at the same version.

## Documentation

See [Riglyph documentation](https://github.com/drhspfn/riglyph/blob/main/docs/architecture.md) and the [getting started guide](https://github.com/drhspfn/riglyph/blob/main/docs/getting-started.md).

Riglyph is an independent project. The current import profile is restricted to **Spine Binary 4.1.23**; there is no claim of all-version compatibility or official runtime parity. Rights to user assets remain with their owners.
