# Riglyph Native C ABI v1

Header: native/include/riglyph_native.h. The ffi crate's build.rs exports the header into Cargo OUT_DIR for packaging. Shared libraries: Windows riglyph_render_ffi.dll, Linux libriglyph_render_ffi.so, macOS libriglyph_render_ffi.dylib.

Functions: rg_renderer_abi_version, rg_renderer_protocol_version, rg_renderer_create, rg_renderer_load_texture, rg_renderer_render, rg_renderer_frame_size, rg_renderer_get_frame, rg_renderer_last_error, rg_renderer_reset, rg_renderer_destroy.

Create returns an opaque handle for 1–16 threads. Caller-owned texture pixels are copied during load. Render accepts a bounded RGP1 binary packet; C/Python may provide arbitrary legal draw packets without a browser. Readback uses a caller-allocated output buffer sized with frame_size: no borrowed Rust memory escapes. last_error copies a NUL-terminated UTF-8 diagnostic into a caller-owned buffer and returns its required length.

Mutating a single handle simultaneously from multiple host threads is unsupported; separate handles can be used concurrently. All FFI calls are wrapped in catch_unwind so no panic crosses C. Pointers must be valid for their supplied lengths; checked null pointers alone cannot make arbitrary invalid foreign pointers safe. Destroy exactly once, and never use a freed handle.

The shared library cannot animate Universal IR without a host animation evaluator. See the compiled C consumer and Python ctypes pixel-verification examples in examples/native-renderer/.