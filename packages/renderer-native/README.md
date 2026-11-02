# @riglyph/renderer-native (optional Rust rasterizer)

Optional **prebuilt** native CPU renderer for Riglyph, using a stable RGP1 v1
binary draw-packet protocol and a persistent Rust process. The TypeScript
`SkeletonInstance`, `AnimationPlayer`, cameras and canonical
`prepareDrawPackets` remain authoritative.

Install alongside the normal Riglyph packages, then download an artifact
matching your OS and CPU architecture from a reviewed native release
(Windows x64, Linux x64, macOS ARM64). Extract `riglyph-native` (or the
Windows `riglyph-native.exe`) and set `RIGLYPH_NATIVE_BIN` to its path.
No Rust compiler is required on a consumer machine.

```ts
import {createNativeRenderer} from '@riglyph/renderer-native';
const native=await createNativeRenderer({threads:4});
// packets: DrawPacket[] from prepareDrawPackets; textures: Map<pageId,RawTexture>
try {
  const rgba=await native.render({packets,textures,viewport,width:800,height:600,
    clear:[0,0,0,0],sampling:'linear'});
  // rgba is an owned Uint8Array; native retains its atlas texture cache
} finally {
  await native.dispose();
}
```

CLI: `riglyph render character.ir.json --images ./textures --clip idle
--backend native-cpu --native-threads 4 --out-dir ./frames`.
`--backend auto` uses the native binary only when compatible/available;
`--backend js` always uses the existing JavaScript rasterizer.

**ABI protocol:** 1 / 1. **Native implementation:** 0.1.0. Independent
of the Riglyph package version (currently 0.16.0; target release 0.16.1).
No automatic npm/native releases or version bumps are performed by A22.

See [native renderer](../../docs/native-renderer.md), [architecture](../../docs/native-renderer-architecture.md)
and [C ABI](../../docs/native-renderer-ffi.md).
