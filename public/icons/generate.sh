#!/bin/bash
# Run this once to generate placeholder icons
# Or replace with real icons from https://maskable.app/
for size in 72 96 128 144 152 192 384 512; do
  convert -size ${size}x${size} xc:#4f52e5 \
    -fill white -font DejaVu-Sans-Bold -pointsize $((size/4)) \
    -gravity center -annotate 0 "C" \
    public/icons/icon-${size}.png 2>/dev/null || \
  python3 -c "
import struct, zlib, base64
size = $size
# Create minimal PNG
def create_png(w, h, color):
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', c)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    raw = b''
    for y in range(h):
        raw += b'\\x00'
        for x in range(w):
            raw += bytes(color)
    idat = zlib.compress(raw)
    return b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
with open('public/icons/icon-${size}.png', 'wb') as f:
    f.write(create_png(size, size, [79, 82, 229]))
"
done
cp public/icons/icon-192.png public/icons/icon-192-maskable.png
cp public/icons/icon-512.png public/icons/icon-512-maskable.png
echo "Icons generated"
