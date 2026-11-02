"""Real C ABI render smoke. Usage: RIGLYPH_NATIVE_LIB=/path/lib... python ctypes-render.py."""
import ctypes
import os
import struct
import sys

def main():
    path = os.environ.get("RIGLYPH_NATIVE_LIB")
    if not path or not os.path.isfile(path):
        raise RuntimeError("Set RIGLYPH_NATIVE_LIB to a compiled native .dll/.so/.dylib")
    lib = ctypes.CDLL(os.path.abspath(path))
    lib.rg_renderer_abi_version.restype = ctypes.c_uint32
    assert lib.rg_renderer_abi_version() == 1
    lib.rg_renderer_create.argtypes = [ctypes.c_uint32]
    lib.rg_renderer_create.restype = ctypes.c_void_p
    lib.rg_renderer_load_texture.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32,
        ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint8), ctypes.c_size_t,
        ctypes.c_uint8, ctypes.c_uint8, ctypes.c_uint8]
    lib.rg_renderer_load_texture.restype = ctypes.c_int
    lib.rg_renderer_render.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint8), ctypes.c_size_t]
    lib.rg_renderer_render.restype = ctypes.c_int
    lib.rg_renderer_frame_size.argtypes = [ctypes.c_void_p]
    lib.rg_renderer_frame_size.restype = ctypes.c_size_t
    lib.rg_renderer_get_frame.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint8), ctypes.c_size_t]
    lib.rg_renderer_get_frame.restype = ctypes.c_size_t
    lib.rg_renderer_destroy.argtypes = [ctypes.c_void_p]
    h = lib.rg_renderer_create(2)
    assert h, "native handle allocation failed"
    try:
        texture = (ctypes.c_uint8 * 4)(240, 100, 40, 255)
        assert lib.rg_renderer_load_texture(h, 7, 1, 1, texture, 4, 0, 0, 0) == 0
        vertices = [(1.,1.,0.,0.), (7.,1.,0.,0.), (1.,7.,0.,0.)]
        body = struct.pack("<II",8,8)
        body += struct.pack("<8d",0.,0.,8.,8.,0.,0.,0.,0.)
        body += struct.pack("<B3xI",0,1)
        body += struct.pack("<IBBH",7,0,0,0)
        body += struct.pack("<7d",1.,1.,1.,1.,0.,0.,0.)
        body += struct.pack("<I",len(vertices))
        for point in vertices:
            body += struct.pack("<4f",*point)
        request = b"RGP1" + struct.pack("<HBB",1,2,0) + body
        packet = (ctypes.c_uint8 * len(request)).from_buffer_copy(request)
        rc = lib.rg_renderer_render(h,packet,len(request))
        assert rc == 0, f"native raster failed: code={rc}"
        n = lib.rg_renderer_frame_size(h)
        assert n == 8*8*4
        output = (ctypes.c_uint8 * n)()
        assert lib.rg_renderer_get_frame(h,output,n) == n
        assert any(bytes(output[i:i+4]) == bytes((240,100,40,255)) for i in range(0,n,4))
        assert bytes(output[:4]) == bytes(4), "outside triangle should remain clear"
        print("Python ctypes: 8x8 actual rendered RGBA verified")
    finally:
        lib.rg_renderer_destroy(h)

if __name__ == "__main__":
    main()
