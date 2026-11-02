/* Automatically copied to OUT_DIR by riglyph-render-ffi/build.rs.
 * Riglyph Native ABI v1; packet protocol v1. MIT licensed. */
#ifndef RIGLYPH_NATIVE_H
#define RIGLYPH_NATIVE_H
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct RiglyphRenderer RiglyphRenderer;
uint32_t rg_renderer_abi_version(void);
uint32_t rg_renderer_protocol_version(void);
RiglyphRenderer *rg_renderer_create(uint32_t threads);
int32_t rg_renderer_load_texture(RiglyphRenderer *, uint32_t id, uint32_t width, uint32_t height,
    const uint8_t *rgba, size_t rgba_len, uint8_t pma, uint8_t wrap_u, uint8_t wrap_v);
int32_t rg_renderer_render(RiglyphRenderer *, const uint8_t *binary_packet, size_t packet_len);
size_t rg_renderer_frame_size(const RiglyphRenderer *);
size_t rg_renderer_get_frame(const RiglyphRenderer *, uint8_t *target, size_t capacity);
size_t rg_renderer_last_error(const RiglyphRenderer *, char *utf8_target, size_t capacity);
int32_t rg_renderer_reset(RiglyphRenderer *);
void rg_renderer_destroy(RiglyphRenderer *);
#ifdef __cplusplus
}
#endif
#endif
