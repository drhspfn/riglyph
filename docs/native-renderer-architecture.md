# Rust native architecture

Universal IR -> TypeScript AnimationPlayer / SkeletonInstance -> canonical draw packets -> versioned RGP1 little-endian buffer -> persistent native process -> deterministic Rust CPU rasterizer -> RGBA8 -> existing PNG or FFmpeg code.

## Binary protocol RGP1 (v1)

Transport frames are uint32 little-endian lengths followed by message bytes; max message 256 MiB. Every request starts with ASCII RGP1, uint16 LE version 1, uint8 command, uint8 feature mask 0. Unknown versions, fields, commands or feature flags fail explicitly.

Commands: 1 LOAD_TEXTURE, 2 RENDER, 3 RESET, 4 PING.

LOAD_TEXTURE fields: uint32 id/width/height, uint8 premultiplied, uint8 wrapU (0 clamp,1 repeat), uint8 wrapV, uint8 reserved=0, uint32 pixelByteLength and RGBA8 raw pixel bytes. Each texture is uploaded once per session and cached. Texture identifiers are numeric, assigned by Node.

RENDER fields: uint32 width/height; 8 float64 values for viewport (left,bottom,width,height) and straight clear RGBA; uint8 sampling (0 nearest, 1 linear), 3 reserved zero bytes; uint32 packet count. Each ordered packet: uint32 texture ID, uint8 blend (0 normal,1 additive,2 multiply,3 screen), uint8 PMA flag, uint16 reserved, four float64 light RGBA, three float64 dark RGB, uint32 vertex count (divisible by three), and packed interleaved float32 [x,y,u,v] per vertex. Pre-clipped triangles and atlas rotation/trim UVs come from the established TypeScript DrawPacket generator. No per-pixel JSON.

Response: uint32 LE byte length, uint8 status (0 success, 1 UTF-8 error), RGBA8 pixels on success. Protocol and ABI are separately versioned from native 0.1.0 and package 0.16.2.

## Ownership, threading and budgets

The Node bridge copies every response into a self-owned Uint8Array. Rust holds the texture cache and a reusable float32 premultiplied framebuffer, with explicit destroy/reset. Memory budgets: 8,388,608 **output framebuffer** pixels, separately 8192 maximum texture side and 33,554,432 pixels per atlas page (4096×4096 verified), 512 MiB total atlas cache, 6 million vertices per request and 256 MiB protocol frame cap. A full atlas may be larger than the output framebuffer. The 32-Mi-pixel page cap keeps one upload beneath the protocol message limit. Threads operate disjoint horizontal bands, with ordered triangle processing within each; no concurrent writes to the same pixel.

No GPU code, source parser, IK or constraint duplication is included. A future wgpu backend can consume FrameInput and implement the same backend interface.