# Riglyph native examples

The Rust library renders **canonical draw packets**, not Spine/Universal IR
animations. Python/C examples generate a single textured triangle and verify
real RGBA output through the v1 C ABI.

Build with `cargo build --manifest-path native/Cargo.toml --release`, then:

```sh
export RIGLYPH_NATIVE_LIB=native/target/release/libriglyph_render_ffi.so
python examples/native-renderer/ctypes-render.py
python examples/native-renderer/c-consumer.py
```

On Windows use `riglyph_render_ffi.dll`, on macOS `libriglyph_render_ffi.dylib`.
Node.js uses `@riglyph/renderer-native` and the persistent native CLI.
See [native renderer](../../docs/native-renderer.md).
